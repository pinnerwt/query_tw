package filters

import (
	"fmt"
	"strings"
	"time"
)

// BuildJobsQuery returns SQL + args. limit is page size; we fetch limit+1 to
// detect a next page.
func BuildJobsQuery(f *Filters, cur *Cursor, limit int, now time.Time) (string, []any) {
	if f == nil {
		f = &Filters{HideSpam: true}
	}
	var sb strings.Builder
	args := []any{}
	add := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	sb.WriteString(`SELECT j.id, j.post_id, j.title, j.company, j.city, j.district, j.remote, j.job_type,
       j.pay_min, j.pay_max, j.pay_period, j.pay_raw, j.posted_at, j.spam_score, j.raw_excerpt,
       p.url, p.author_handle, p.author_name
FROM jobs j JOIN posts p ON p.id = j.post_id
WHERE 1=1`)

	// Spam threshold
	thr := float32(1.01)
	if f.HideSpam {
		thr = 0.7
	}
	sb.WriteString(" AND j.spam_score < " + add(thr))

	// City filter (with remote OR)
	if len(f.Cities) > 0 {
		clause := "(j.city = ANY(" + add(f.Cities) + ")"
		if f.RemoteOK {
			clause += " OR j.remote"
		}
		clause += ")"
		sb.WriteString(" AND " + clause)
	} else if f.RemoteOK {
		sb.WriteString(" AND j.remote = true")
	}

	// Pay
	if f.PayMin > 0 {
		sb.WriteString(" AND j.pay_max >= " + add(f.PayMin))
		if f.PayPeriod != "" {
			sb.WriteString(" AND j.pay_period = " + add(f.PayPeriod))
		}
	}

	// Period (recency)
	if cutoff := recencyToCutoff(f.Period, now); !cutoff.IsZero() {
		sb.WriteString(" AND j.posted_at >= " + add(cutoff))
	}

	// Job type
	if len(f.JobTypes) > 0 {
		sb.WriteString(" AND j.job_type = ANY(" + add(f.JobTypes) + ")")
	}

	// Keyword (Postgres tsvector, plainto for forgiving parsing)
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		sb.WriteString(" AND j.search_tsv @@ plainto_tsquery('simple', " + add(kw) + ")")
	}

	// Skill rows: each is EXISTS (...)
	for _, s := range f.Skills {
		nm := add(s.Name)
		sb.WriteString(fmt.Sprintf(` AND EXISTS (
  SELECT 1 FROM job_skills js JOIN skills sk ON sk.id = js.skill_id
  WHERE js.job_id = j.id AND (LOWER(sk.canonical) = LOWER(%s) OR %s = ANY(sk.aliases))
    AND COALESCE(js.years_min, 0) <= %s
)`, nm, nm, add(int(s.YearsMin))))
	}

	// Experience rows
	for _, r := range f.Experience {
		nm := add(r.Name)
		sb.WriteString(fmt.Sprintf(` AND EXISTS (
  SELECT 1 FROM job_experience je JOIN roles ro ON ro.id = je.role_id
  WHERE je.job_id = j.id AND (LOWER(ro.canonical) = LOWER(%s) OR %s = ANY(ro.aliases))
    AND COALESCE(je.years_min, 0) <= %s
)`, nm, nm, add(int(r.YearsMin))))
	}

	// Cursor (keyset pagination on posted_at DESC, id DESC)
	if cur != nil {
		sb.WriteString(" AND (j.posted_at, j.id) < (" + add(cur.PostedAt) + ", " + add(cur.ID) + ")")
	}

	sb.WriteString(" ORDER BY j.posted_at DESC, j.id DESC LIMIT " + add(limit+1))

	return sb.String(), args
}
