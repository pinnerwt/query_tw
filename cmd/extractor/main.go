package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pgi/matching/internal/config"
	"github.com/pgi/matching/internal/db"
	"github.com/pgi/matching/internal/extract"
)

// extractor: in MVP, supports two modes:
//   --seed   : load fixtures/jobs.json (canned extractions) into postgres directly
//   default  : skeleton loop, no live operation (full Redis BLPOP loop in Phase 6.4)

func main() {
	seed := flag.Bool("seed", false, "load fixtures/jobs.json directly into postgres")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err)
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if *seed {
		if err := runSeed(ctx, pool); err != nil {
			logger.Error("seed", "err", err)
			os.Exit(1)
		}
		logger.Info("seed complete")
		return
	}
	logger.Info("extractor: no live mode in MVP iteration; use --seed to load fixtures")
}

type fixture struct {
	URL          string                  `json:"url"`
	AuthorHandle string                  `json:"author_handle"`
	AuthorName   string                  `json:"author_name"`
	PostedAt     time.Time               `json:"posted_at"`
	RawText      string                  `json:"raw_text"`
	Stitched     bool                    `json:"stitched"`
	Extraction   extract.JobsExtraction  `json:"extraction"`
}

func runSeed(ctx context.Context, pool *pgxpool.Pool) error {
	path := os.Getenv("FIXTURES_PATH")
	if path == "" {
		path = "/app/fixtures/jobs.json"
		if _, err := os.Stat(path); err != nil {
			path = "./fixtures/jobs.json"
		}
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read fixtures: %w", err)
	}
	var rows []fixture
	if err := json.Unmarshal(body, &rows); err != nil {
		return err
	}
	for i, f := range rows {
		_, err := extract.Persist(ctx, pool, extract.PostMeta{
			URL: f.URL, AuthorHandle: f.AuthorHandle, AuthorName: f.AuthorName,
			PostedAt: f.PostedAt, Stitched: f.Stitched, RawText: f.RawText,
		}, &f.Extraction)
		if err != nil {
			return fmt.Errorf("persist row %d (%s): %w", i, f.URL, err)
		}
	}
	slog.Info("seeded fixtures", "count", len(rows))
	return nil
}

