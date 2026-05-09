package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Pool = pgxpool.Pool

func Open(ctx context.Context, dsn string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}

// MigrateUp applies any *.up.sql files not yet recorded in schema_migrations.
func MigrateUp(ctx context.Context, pool *Pool, dir string) error {
	if err := ensureTable(ctx, pool); err != nil {
		return err
	}
	files, err := readMigrations(dir, ".up.sql")
	if err != nil {
		return err
	}
	applied, err := appliedSet(ctx, pool)
	if err != nil {
		return err
	}
	for _, f := range files {
		ver := versionOf(f)
		if applied[ver] {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil {
			return err
		}
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(body)); err != nil {
				return fmt.Errorf("apply %s: %w", f, err)
			}
			_, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, ver)
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// MigrateDown applies *.down.sql files in reverse for all currently-applied versions.
func MigrateDown(ctx context.Context, pool *Pool, dir string) error {
	if err := ensureTable(ctx, pool); err != nil {
		return err
	}
	applied, err := appliedSet(ctx, pool)
	if err != nil {
		return err
	}
	versions := make([]string, 0, len(applied))
	for v := range applied {
		versions = append(versions, v)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(versions)))
	for _, v := range versions {
		path := filepath.Join(dir, v+".down.sql")
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(body)); err != nil {
				return fmt.Errorf("revert %s: %w", v, err)
			}
			_, err := tx.Exec(ctx, `DELETE FROM schema_migrations WHERE version = $1`, v)
			return err
		})
		if err != nil {
			return err
		}
	}
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS schema_migrations`); err != nil {
		return err
	}
	return nil
}

func ensureTable(ctx context.Context, pool *Pool) error {
	_, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
	return err
}

func appliedSet(ctx context.Context, pool *Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = true
	}
	return out, rows.Err()
}

func readMigrations(dir, suffix string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.HasSuffix(e.Name(), suffix) {
			files = append(files, e.Name())
		}
	}
	if len(files) == 0 {
		return nil, errors.New("no migration files found in " + dir)
	}
	sort.Strings(files)
	return files, nil
}

func versionOf(name string) string {
	// "0001_init.up.sql" → "0001_init"
	for _, s := range []string{".up.sql", ".down.sql"} {
		if strings.HasSuffix(name, s) {
			return strings.TrimSuffix(name, s)
		}
	}
	return name
}
