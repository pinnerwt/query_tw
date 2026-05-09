package admin

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RunDailyReport computes a one-day snapshot and upserts into daily_reports.
// Counts are scoped to the previous local day (Asia/Taipei) by default.
func RunDailyReport(ctx context.Context, pool *pgxpool.Pool) error {
	loc, err := time.LoadLocation("Asia/Taipei")
	if err != nil || loc == nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).Add(-24 * time.Hour)
	dayEnd := dayStart.Add(24 * time.Hour)

	type counts struct {
		Posts            int `json:"posts"`
		Jobs             int `json:"jobs"`
		ExtractionFailed int `json:"extraction_failed"`
		SpamPosts        int `json:"spam_posts"`
		PendingSkills    int `json:"pending_skills"`
		PendingRoles     int `json:"pending_roles"`
	}
	var c counts
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM posts WHERE fetched_at >= $1 AND fetched_at < $2`, dayStart, dayEnd).Scan(&c.Posts); err != nil {
		return err
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE posted_at >= $1 AND posted_at < $2`, dayStart, dayEnd).Scan(&c.Jobs); err != nil {
		return err
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM posts WHERE fetched_at >= $1 AND fetched_at < $2 AND extraction_failed=true`, dayStart, dayEnd).Scan(&c.ExtractionFailed); err != nil {
		return err
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM posts WHERE fetched_at >= $1 AND fetched_at < $2 AND spam_score >= 0.7`, dayStart, dayEnd).Scan(&c.SpamPosts); err != nil {
		return err
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM skills WHERE approved=false`).Scan(&c.PendingSkills); err != nil {
		return err
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM roles WHERE approved=false`).Scan(&c.PendingRoles); err != nil {
		return err
	}
	payload, _ := json.Marshal(c)
	_, err = pool.Exec(ctx, `
INSERT INTO daily_reports (date, payload) VALUES ($1, $2::jsonb)
ON CONFLICT (date) DO UPDATE SET payload = EXCLUDED.payload`, dayStart.Format("2006-01-02"), payload)
	return err
}

// StartDailyReportLoop runs RunDailyReport once at startup and then every 24h.
func StartDailyReportLoop(ctx context.Context, pool *pgxpool.Pool) {
	go func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		run := func() {
			if err := RunDailyReport(ctx, pool); err != nil {
				slog.Warn("daily report failed", "err", err)
			} else {
				slog.Info("daily report written")
			}
		}
		// Wait briefly for migrations on cold start, then run.
		time.Sleep(10 * time.Second)
		run()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
}
