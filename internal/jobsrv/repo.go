package jobsrv

import (
	"context"
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pgi/matching/internal/domain"
	"github.com/pgi/matching/internal/filters"
)

var _ = time.Time{}

type Repo struct {
	Pool *pgxpool.Pool
}

type rawRow struct {
	id           []byte
	postID       []byte
	title        string
	company      *string
	city         *string
	district     *string
	remote       bool
	jobType      string
	payMin       *int
	payMax       *int
	payPeriod    *string
	payRaw       *string
	postedAt     time.Time
	spamScore    float32
	rawExcerpt   *string
	url          string
	authorHandle string
	authorName   *string
}

// List runs a pre-built filter SQL and returns hydrated JobViews. nextCur is
// non-nil iff there is a further page.
func (r *Repo) List(ctx context.Context, sqlStr string, args []any, limit int) ([]domain.JobView, *filters.Cursor, error) {
	rows, err := r.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var raws []rawRow
	for rows.Next() {
		var rr rawRow
		if err := rows.Scan(&rr.id, &rr.postID, &rr.title, &rr.company, &rr.city, &rr.district,
			&rr.remote, &rr.jobType, &rr.payMin, &rr.payMax, &rr.payPeriod, &rr.payRaw,
			&rr.postedAt, &rr.spamScore, &rr.rawExcerpt, &rr.url, &rr.authorHandle, &rr.authorName); err != nil {
			return nil, nil, err
		}
		raws = append(raws, rr)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	var nextCur *filters.Cursor
	if len(raws) > limit {
		// last record is the "peek"; do not include it in result, use it as cursor
		extra := raws[limit]
		nextCur = &filters.Cursor{PostedAt: extra.postedAt, ID: extra.id}
		raws = raws[:limit]
	}

	if len(raws) == 0 {
		return []domain.JobView{}, nextCur, nil
	}

	ids := make([][]byte, 0, len(raws))
	for _, rr := range raws {
		ids = append(ids, rr.id)
	}
	skills, err := r.fetchSkills(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	exps, err := r.fetchExperience(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	langs, err := r.fetchLanguages(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	tags, err := r.fetchTags(ctx, ids)
	if err != nil {
		return nil, nil, err
	}

	out := make([]domain.JobView, 0, len(raws))
	for _, rr := range raws {
		hexID := hex.EncodeToString(rr.id)
		v := domain.JobView{
			ID:    hexID,
			Title: rr.title,
			Location: domain.Location{
				Remote: rr.remote,
			},
			JobType: rr.jobType,
			Pay: domain.Pay{
				Period: deref(rr.payPeriod),
				Raw:    deref(rr.payRaw),
			},
			Requirements: domain.Requirements{
				Skills:     skills[hexID],
				Experience: exps[hexID],
				Languages:  langs[hexID],
			},
			Tags:       tags[hexID],
			PostedAt:   rr.postedAt,
			SourceURL:  rr.url,
			Author:     domain.Author{Handle: rr.authorHandle, Name: deref(rr.authorName)},
			SpamScore:  rr.spamScore,
			RawExcerpt: deref(rr.rawExcerpt),
		}
		if rr.company != nil {
			v.Company = *rr.company
		}
		if rr.city != nil {
			v.Location.City = *rr.city
		}
		if rr.district != nil {
			v.Location.District = *rr.district
		}
		if rr.payMin != nil {
			min := *rr.payMin
			v.Pay.Min = &min
		}
		if rr.payMax != nil {
			max := *rr.payMax
			v.Pay.Max = &max
		}
		// ensure non-nil slices for stable JSON
		if v.Requirements.Skills == nil {
			v.Requirements.Skills = []domain.SkillReq{}
		}
		if v.Requirements.Experience == nil {
			v.Requirements.Experience = []domain.RoleReq{}
		}
		if v.Requirements.Languages == nil {
			v.Requirements.Languages = []domain.LangReq{}
		}
		if v.Tags == nil {
			v.Tags = []string{}
		}
		out = append(out, v)
	}
	return out, nextCur, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (r *Repo) fetchSkills(ctx context.Context, ids [][]byte) (map[string][]domain.SkillReq, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT js.job_id, sk.canonical, js.years_min
FROM job_skills js JOIN skills sk ON sk.id = js.skill_id
WHERE js.job_id = ANY($1)
ORDER BY sk.canonical`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string][]domain.SkillReq{}
	for rows.Next() {
		var jobID []byte
		var name string
		var years *int
		if err := rows.Scan(&jobID, &name, &years); err != nil {
			return nil, err
		}
		k := hex.EncodeToString(jobID)
		req := domain.SkillReq{Name: name}
		if years != nil {
			y := *years
			req.YearsMin = &y
		}
		m[k] = append(m[k], req)
	}
	return m, rows.Err()
}

func (r *Repo) fetchExperience(ctx context.Context, ids [][]byte) (map[string][]domain.RoleReq, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT je.job_id, ro.canonical, je.years_min
FROM job_experience je JOIN roles ro ON ro.id = je.role_id
WHERE je.job_id = ANY($1)
ORDER BY ro.canonical`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string][]domain.RoleReq{}
	for rows.Next() {
		var jobID []byte
		var name string
		var years *int
		if err := rows.Scan(&jobID, &name, &years); err != nil {
			return nil, err
		}
		k := hex.EncodeToString(jobID)
		req := domain.RoleReq{Role: name}
		if years != nil {
			y := *years
			req.YearsMin = &y
		}
		m[k] = append(m[k], req)
	}
	return m, rows.Err()
}

func (r *Repo) fetchLanguages(ctx context.Context, ids [][]byte) (map[string][]domain.LangReq, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT job_id, language, level
FROM job_languages WHERE job_id = ANY($1)
ORDER BY language`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string][]domain.LangReq{}
	for rows.Next() {
		var jobID []byte
		var name string
		var level *string
		if err := rows.Scan(&jobID, &name, &level); err != nil {
			return nil, err
		}
		k := hex.EncodeToString(jobID)
		req := domain.LangReq{Name: name, Level: deref(level)}
		m[k] = append(m[k], req)
	}
	return m, rows.Err()
}

func (r *Repo) fetchTags(ctx context.Context, ids [][]byte) (map[string][]string, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT job_id, tag FROM job_tags WHERE job_id = ANY($1) ORDER BY tag`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string][]string{}
	for rows.Next() {
		var jobID []byte
		var tag string
		if err := rows.Scan(&jobID, &tag); err != nil {
			return nil, err
		}
		k := hex.EncodeToString(jobID)
		m[k] = append(m[k], tag)
	}
	return m, rows.Err()
}

// FetchOne returns a single hydrated JobView by hex id.
func (r *Repo) FetchOne(ctx context.Context, hexID string) (*domain.JobView, error) {
	id, err := hex.DecodeString(hexID)
	if err != nil {
		return nil, err
	}
	row := r.Pool.QueryRow(ctx, `
SELECT j.id, j.post_id, j.title, j.company, j.city, j.district, j.remote, j.job_type,
       j.pay_min, j.pay_max, j.pay_period, j.pay_raw, j.posted_at, j.spam_score, j.raw_excerpt,
       p.url, p.author_handle, p.author_name
FROM jobs j JOIN posts p ON p.id = j.post_id
WHERE j.id = $1`, id)
	var rr rawRow
	if err := row.Scan(&rr.id, &rr.postID, &rr.title, &rr.company, &rr.city, &rr.district,
		&rr.remote, &rr.jobType, &rr.payMin, &rr.payMax, &rr.payPeriod, &rr.payRaw,
		&rr.postedAt, &rr.spamScore, &rr.rawExcerpt, &rr.url, &rr.authorHandle, &rr.authorName); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	skills, _ := r.fetchSkills(ctx, [][]byte{rr.id})
	exps, _ := r.fetchExperience(ctx, [][]byte{rr.id})
	langs, _ := r.fetchLanguages(ctx, [][]byte{rr.id})
	tags, _ := r.fetchTags(ctx, [][]byte{rr.id})
	hexK := hex.EncodeToString(rr.id)
	v := domain.JobView{
		ID:    hexK,
		Title: rr.title,
		Location: domain.Location{
			Remote: rr.remote,
		},
		JobType: rr.jobType,
		Pay: domain.Pay{
			Period: deref(rr.payPeriod),
			Raw:    deref(rr.payRaw),
		},
		Requirements: domain.Requirements{
			Skills:     skills[hexK],
			Experience: exps[hexK],
			Languages:  langs[hexK],
		},
		Tags:       tags[hexK],
		PostedAt:   rr.postedAt,
		SourceURL:  rr.url,
		Author:     domain.Author{Handle: rr.authorHandle, Name: deref(rr.authorName)},
		SpamScore:  rr.spamScore,
		RawExcerpt: deref(rr.rawExcerpt),
	}
	if rr.company != nil {
		v.Company = *rr.company
	}
	if rr.city != nil {
		v.Location.City = *rr.city
	}
	if rr.district != nil {
		v.Location.District = *rr.district
	}
	if rr.payMin != nil {
		min := *rr.payMin
		v.Pay.Min = &min
	}
	if rr.payMax != nil {
		max := *rr.payMax
		v.Pay.Max = &max
	}
	if v.Requirements.Skills == nil {
		v.Requirements.Skills = []domain.SkillReq{}
	}
	if v.Requirements.Experience == nil {
		v.Requirements.Experience = []domain.RoleReq{}
	}
	if v.Requirements.Languages == nil {
		v.Requirements.Languages = []domain.LangReq{}
	}
	if v.Tags == nil {
		v.Tags = []string{}
	}
	return &v, nil
}
