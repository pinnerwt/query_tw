package extract

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostMeta struct {
	URL          string
	AuthorHandle string
	AuthorName   string
	PostedAt     time.Time
	Stitched     bool
	RawText      string
}

func PostID(url string) []byte {
	sum := sha256.Sum256([]byte(url))
	return sum[:16]
}

func JobID(postID []byte, ordinal int) []byte {
	h := sha256.New()
	h.Write(postID)
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], uint32(ordinal))
	h.Write(b[:])
	sum := h.Sum(nil)
	return sum[:16]
}

// Persist writes the post + jobs + side-tables atomically. Idempotent on
// posts.url (ON CONFLICT DO NOTHING). Unknown skills/roles are inserted
// with approved=false.
func Persist(ctx context.Context, pool *pgxpool.Pool, meta PostMeta, ex *JobsExtraction) (postID []byte, err error) {
	postID = PostID(meta.URL)
	rawJSON, _ := json.Marshal(ex)

	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// Upsert post (no-op if URL already exists)
		_, err := tx.Exec(ctx, `
INSERT INTO posts (id, url, author_handle, author_name, posted_at, stitched, job_count, spam_score, raw_text, raw_extraction)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (url) DO UPDATE SET
  raw_extraction = EXCLUDED.raw_extraction,
  job_count = EXCLUDED.job_count,
  spam_score = EXCLUDED.spam_score`,
			postID, meta.URL, meta.AuthorHandle, nullify(meta.AuthorName),
			meta.PostedAt, meta.Stitched, len(ex.Jobs), ex.SpamScore, meta.RawText, rawJSON)
		if err != nil {
			return fmt.Errorf("insert post: %w", err)
		}

		// Wipe prior child rows on re-extract (stable ordinals per post)
		if _, err := tx.Exec(ctx, `DELETE FROM jobs WHERE post_id = $1`, postID); err != nil {
			return err
		}

		for i, j := range ex.Jobs {
			ordinal := i + 1
			jid := JobID(postID, ordinal)
			searchTSV := buildSearchText(j)
			_, err := tx.Exec(ctx, `
INSERT INTO jobs (id, post_id, ordinal, title, company, city, district, remote, job_type,
                  pay_min, pay_max, pay_period, pay_raw, raw_excerpt, posted_at, spam_score, search_tsv)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, to_tsvector('simple', $17))`,
				jid, postID, ordinal, j.Title, nullify(j.Company), nullify(j.City), nullify(j.District),
				j.Remote, jobTypeOrDefault(j.JobType), j.PayMin, j.PayMax, nullify(j.PayPeriod),
				nullify(j.PayRaw), nullify(j.RawExcerpt), meta.PostedAt, ex.SpamScore, searchTSV)
			if err != nil {
				return fmt.Errorf("insert job: %w", err)
			}
			for _, s := range j.Skills {
				skillID, err := upsertDict(ctx, tx, "skills", s.Name)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `INSERT INTO job_skills (job_id, skill_id, years_min) VALUES ($1,$2,$3)
ON CONFLICT DO NOTHING`, jid, skillID, s.YearsMin); err != nil {
					return fmt.Errorf("insert job_skill: %w", err)
				}
			}
			for _, r := range j.Experience {
				roleID, err := upsertDict(ctx, tx, "roles", r.Role)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `INSERT INTO job_experience (job_id, role_id, years_min) VALUES ($1,$2,$3)
ON CONFLICT DO NOTHING`, jid, roleID, r.YearsMin); err != nil {
					return err
				}
			}
			for _, l := range j.Languages {
				if _, err := tx.Exec(ctx, `INSERT INTO job_languages (job_id, language, level) VALUES ($1,$2,$3)
ON CONFLICT DO NOTHING`, jid, l.Name, nullify(l.Level)); err != nil {
					return err
				}
			}
			for _, t := range j.Tags {
				if _, err := tx.Exec(ctx, `INSERT INTO job_tags (job_id, tag) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, jid, t); err != nil {
					return err
				}
			}
			for _, c := range j.Categories {
				catID, err := upsertDict(ctx, tx, "categories", c)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `INSERT INTO job_categories (job_id, category_id) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, jid, catID); err != nil {
					return fmt.Errorf("insert job_category: %w", err)
				}
			}
		}
		return nil
	})
	return postID, err
}

func upsertDict(ctx context.Context, tx pgx.Tx, table, name string) (int, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("empty %s name", table)
	}
	var id int
	err := tx.QueryRow(ctx, `SELECT id FROM `+table+` WHERE LOWER(canonical) = LOWER($1) OR $1 = ANY(aliases) LIMIT 1`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return 0, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO `+table+` (canonical, aliases, approved) VALUES ($1, '{}', false) RETURNING id`, name).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert %s: %w", table, err)
	}
	return id, nil
}

func nullify(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func jobTypeOrDefault(s string) string {
	if s == "" {
		return "full_time"
	}
	return s
}

func buildSearchText(j ExtractedJob) string {
	parts := []string{j.Title, j.Company, j.City, j.District, j.RawExcerpt}
	for _, s := range j.Skills {
		parts = append(parts, s.Name)
	}
	for _, t := range j.Tags {
		parts = append(parts, t)
	}
	parts = append(parts, j.Categories...)
	return strings.Join(parts, " ")
}
