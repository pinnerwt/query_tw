package announcements

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const maxBodyBytes = 4096

type Announcement struct {
	ID        int64     `json:"id"`
	Severity  string    `json:"severity"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type Repo struct {
	Pool *pgxpool.Pool
}

func validSeverity(s string) bool {
	switch s {
	case "info", "warning", "critical":
		return true
	}
	return false
}

func validBody(b string) error {
	if len(b) == 0 {
		return errors.New("body is empty")
	}
	if len(b) > maxBodyBytes {
		return errors.New("body exceeds 4096 bytes")
	}
	return nil
}

// List returns announcements ordered critical-first, then newest-first.
func (r *Repo) List(ctx context.Context) ([]Announcement, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT id, severity, body, created_at
FROM announcements
ORDER BY (severity = 'critical') DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Announcement{}
	for rows.Next() {
		var a Announcement
		if err := rows.Scan(&a.ID, &a.Severity, &a.Body, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repo) Create(ctx context.Context, severity, body string) (Announcement, error) {
	if !validSeverity(severity) {
		return Announcement{}, errors.New("invalid severity")
	}
	if err := validBody(body); err != nil {
		return Announcement{}, err
	}
	var a Announcement
	err := r.Pool.QueryRow(ctx, `
INSERT INTO announcements (severity, body)
VALUES ($1, $2)
RETURNING id, severity, body, created_at`, severity, body).
		Scan(&a.ID, &a.Severity, &a.Body, &a.CreatedAt)
	return a, err
}

func (r *Repo) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM announcements WHERE id=$1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
