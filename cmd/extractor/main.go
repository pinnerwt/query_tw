package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/pgi/matching/internal/config"
	"github.com/pgi/matching/internal/db"
	"github.com/pgi/matching/internal/extract"
)

// extractor: BLPOPs `extract_queue`, calls DeepSeek, persists.
//   --once   : drain whatever is in the queue right now and exit (for first-run / cron).
//   default  : long-running worker.

func main() {
	once := flag.Bool("once", false, "drain queue once and exit")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}
	if cfg.DeepSeekAPIKey == "" {
		logger.Error("DEEPSEEK_API_KEY not set")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	rds, err := openRedis(cfg.RedisURL)
	if err != nil {
		logger.Error("redis", "err", err)
		os.Exit(1)
	}
	defer rds.Close()

	dict, err := loadDict(ctx, pool)
	if err != nil {
		logger.Error("dict", "err", err)
		os.Exit(1)
	}
	system := extract.BuildPrompt(dict.Skills, dict.Roles)
	client := &extract.Client{APIKey: cfg.DeepSeekAPIKey}

	logger.Info("extractor ready", "once", *once, "skills", len(dict.Skills), "roles", len(dict.Roles))

	for {
		var raw []string
		if *once {
			val, err := rds.LPop(ctx, "extract_queue").Result()
			if errors.Is(err, redis.Nil) {
				return
			}
			if err != nil {
				logger.Warn("lpop", "err", err)
				return
			}
			raw = []string{"extract_queue", val}
		} else {
			vals, err := rds.BLPop(ctx, 30*time.Second, "extract_queue").Result()
			if errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
				if ctx.Err() != nil {
					return
				}
				continue
			}
			if err != nil {
				logger.Warn("blpop", "err", err)
				time.Sleep(2 * time.Second)
				continue
			}
			raw = vals
		}
		if len(raw) < 2 {
			continue
		}
		if err := handleOne(ctx, pool, client, system, raw[1]); err != nil {
			logger.Warn("handle", "err", err)
		}
	}
}

type queueItem struct {
	URL          string    `json:"url"`
	AuthorHandle string    `json:"author_handle"`
	AuthorName   string    `json:"author_name"`
	PostedAt     time.Time `json:"posted_at"`
	RawText      string    `json:"raw_text"`
	Stitched     bool      `json:"stitched"`
}

func handleOne(ctx context.Context, pool *pgxpool.Pool, c *extract.Client, system, payload string) error {
	var q queueItem
	if err := json.Unmarshal([]byte(payload), &q); err != nil {
		return err
	}
	res, _, err := c.Extract(ctx, system, q.RawText)
	if err != nil {
		// record the failure so we don't re-extract forever
		_ = recordFailure(ctx, pool, q)
		slog.Warn("extract failed", "url", q.URL, "err", err)
		return err
	}
	_, err = extract.Persist(ctx, pool, extract.PostMeta{
		URL: q.URL, AuthorHandle: q.AuthorHandle, AuthorName: q.AuthorName,
		PostedAt: q.PostedAt, Stitched: q.Stitched, RawText: q.RawText,
	}, res)
	if err != nil {
		return err
	}
	slog.Info("persisted", "url", q.URL, "jobs", len(res.Jobs), "spam", res.SpamScore)
	return nil
}

func recordFailure(ctx context.Context, pool *pgxpool.Pool, q queueItem) error {
	_, err := pool.Exec(ctx, `
INSERT INTO posts (id, url, author_handle, author_name, posted_at, fetched_at, stitched, job_count, raw_text, extraction_failed)
VALUES ($1, $2, $3, NULLIF($4,''), $5, now(), $6, 0, $7, true)
ON CONFLICT (url) DO UPDATE SET extraction_failed = true, fetched_at = now()`,
		extract.PostID(q.URL), q.URL, q.AuthorHandle, q.AuthorName, q.PostedAt, q.Stitched, q.RawText)
	return err
}

type dict struct {
	Skills []string
	Roles  []string
}

func loadDict(ctx context.Context, pool *pgxpool.Pool) (*dict, error) {
	d := &dict{}
	rows, err := pool.Query(ctx, "SELECT canonical FROM skills WHERE approved=true ORDER BY canonical")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		d.Skills = append(d.Skills, s)
	}
	rows.Close()
	rows, err = pool.Query(ctx, "SELECT canonical FROM roles WHERE approved=true ORDER BY canonical")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		d.Roles = append(d.Roles, s)
	}
	rows.Close()
	return d, nil
}

func openRedis(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opt), nil
}
