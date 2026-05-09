# 脆找工作 — MVP Design

Date: 2026-05-09
Domain: query.tw
Host: `monitor` (via candy compose)

## Goal

A zh-TW PWA that surfaces job postings published on Threads.com. The
scraper polls Threads search for `徵才` and `找人`, an LLM extracts
structured job records, and a Vite/React frontend lets users filter and
favorite jobs. All user state (filter profiles, favorites) lives on the
device and is transferable between devices via QR.

## Stack

- **Backend**: Go monorepo, three binaries (`api`, `scraper`, `extractor`)
- **Database**: PostgreSQL 16
- **Cache / queue**: Redis 7
- **Frontend**: Vite + React + Tailwind + TanStack Query + Zustand,
  PWA via vite-plugin-pwa
- **LLM**: DeepSeek (OpenAI-compatible API), structured output via JSON
  schema, prompt-cached system prefix
- **Scraper runtime**: Playwright with a logged-in burner Threads account
- **Reverse proxy**: Caddy (candy compose), TLS for query.tw
- **Wire format for filters/config**: protobuf (single message reused
  for QR export, IndexedDB persistence, and API requests)

## Architecture

```
Threads.com (search UI)
   │ headless scrape (hourly + jitter)
   ▼
[scraper] ──RPUSH──▶ Redis extract_queue
                       │
                       ▼ BLPOP
                   [extractor] ──DeepSeek──▶ JSON jobs
                       │
                       ▼ tx
                   Postgres (posts, jobs, job_skills, …)
                       │
   Redis cache ◀──invalidate──┤
                       │
                   [api] ─── /api/jobs?filters&cursor ──▶ PWA
                                                          │
                                            IndexedDB ◀──┤
                                            (Config, favorites, seen)
                                                          │
                                                       QR export/import
```

Three binaries from one monorepo. Scraper and extractor are split so a
slow LLM call cannot block fetching, and they scale independently.

## Ingestion pipeline

### Scraper

Logged-in Playwright instance (persistent context). Every hour with
±5min jitter:

```
for query in ["徵才", "找人"]:
  open https://www.threads.com/search?q={q}&filter=recent
  consecutive_known := 0
  while consecutive_known < 3 and scrolls < 200:
    for card in newly visible:
      if redis.SISMEMBER("seen_post_urls", card.url):
        consecutive_known += 1
      else:
        consecutive_known := 0
        if snippet looks truncated (ends "...", contains "詳情見留言"|"見留言"|"私訊"):
          open detail page; collect main + replies authored by same handle
          stitched := true
        else:
          stitched := false
        redis.RPUSH("extract_queue", {meta, text, stitched})
        redis.SADD("seen_post_urls", card.url)
    scroll
```

Stop conditions: 3 consecutive known posts, 200-scroll cap, 10-minute
wall-clock cap.

### Extractor

```
loop:
  job := redis.BLPOP("extract_queue", 30s)
  result := deepseek.chat({
    system: <cached prompt + skills + roles dictionaries>,
    user:   stitched_text,
    response_format: json_schema(JobsExtraction)
  })
  // result := { jobs: [...], spam_score, _new_skills, _new_roles }

  begin tx:
    INSERT INTO posts (...)            -- one row, even when 0 jobs
    for j in result.jobs (1..N):
      INSERT INTO jobs (...)
      INSERT INTO job_skills, job_experience, job_languages, job_tags
    INSERT new candidate skills/roles with approved=false
  commit
  redis.PUBLISH("jobs:invalidate", "1")
```

A post may contain 0, 1, or multiple distinct openings. `posts.job_count = 0`
records non-jobs/spam so they are never re-LLMed.

### LLM prompt

System prompt (cached, ~3KB) describes:
- Output schema (JSON), zh-TW source.
- Multi-job semantics — return a list.
- Canonical skill/role lists (~500 entries each); unknown entries go
  into `_new_skills`/`_new_roles` for admin review.
- Pay normalization to `{min, max, period ∈ hourly|daily|monthly|per_case}`.
- `spam_score` 0..1 with examples (MLM, 酒店, 博弈, 「無經驗高薪」…).

Prompt caching amortizes the dictionary prefix.

### Cost guardrails

- Extractor reads `llm_spend_cents:YYYY-MM-DD` and pauses when daily cap
  ($5 default) is hit.
- Failed extractions retry up to 3× then mark `extraction_failed=true`.

## Data model

```sql
CREATE TABLE posts (
  id            BYTEA PRIMARY KEY,        -- SHA-256(url)[:16]
  url           TEXT NOT NULL UNIQUE,
  author_handle TEXT NOT NULL,
  author_name   TEXT,
  posted_at     TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  stitched      BOOLEAN NOT NULL,
  job_count     INT  NOT NULL,            -- 0 = not a job ad / spam
  spam_score    REAL
);

CREATE TABLE jobs (
  id          BYTEA PRIMARY KEY,          -- SHA-256(post_id || ordinal)[:16]
  post_id     BYTEA NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  ordinal     INT  NOT NULL,
  title       TEXT NOT NULL,
  company     TEXT,
  city        TEXT,
  district    TEXT,
  remote      BOOLEAN NOT NULL DEFAULT false,
  job_type    TEXT NOT NULL,              -- full_time|part_time|freelance|intern|contract
  pay_min     INT,
  pay_max     INT,
  pay_period  TEXT,                        -- hourly|daily|monthly|per_case
  pay_raw     TEXT,
  language    TEXT,
  posted_at   TIMESTAMPTZ NOT NULL,        -- denormalized for cheap sort
  spam_score  REAL NOT NULL DEFAULT 0,
  search_tsv  TSVECTOR,
  UNIQUE (post_id, ordinal)
);
CREATE INDEX jobs_posted_at_idx ON jobs (posted_at DESC, id DESC);
CREATE INDEX jobs_city_idx      ON jobs (city) WHERE city IS NOT NULL;
CREATE INDEX jobs_search_idx    ON jobs USING GIN (search_tsv);

CREATE TABLE job_skills     (job_id BYTEA, skill_id INT, years_min INT, PRIMARY KEY (job_id, skill_id));
CREATE TABLE job_experience (job_id BYTEA, role_id  INT, years_min INT, PRIMARY KEY (job_id, role_id));
CREATE TABLE job_languages  (job_id BYTEA, language TEXT, level TEXT,    PRIMARY KEY (job_id, language));
CREATE TABLE job_tags       (job_id BYTEA, tag TEXT,                     PRIMARY KEY (job_id, tag));

CREATE TABLE skills (id SERIAL PK, canonical TEXT UNIQUE, aliases TEXT[], approved BOOLEAN DEFAULT true);
CREATE TABLE roles  (id SERIAL PK, canonical TEXT UNIQUE, aliases TEXT[], approved BOOLEAN DEFAULT true);
```

Skills/experience/languages live in side tables (not JSONB) because the
multi-row slider filter requires `EXISTS … years_min ≤ ?` checks per
active filter row — JSONB makes this painful.

A canonical skill/role dictionary keeps the facet dropdown sane;
unrecognized entries go into a review queue.

## API

```
GET  /api/jobs?filters=<base64-protobuf>&cursor=<opaque>&limit=30
GET  /api/jobs/:id
GET  /api/skills          # canonical list (cached 5m)
GET  /api/roles
GET  /api/cities
GET  /healthz
GET  /metrics             # Prometheus

# admin (basic-auth)
GET  /admin/skills/pending
POST /admin/skills/approve
POST /admin/skills/reject
GET  /admin/posts/:id/raw
```

Pagination is keyset on `(posted_at DESC, id DESC)` so newly inserted
jobs do not cause page skips/duplicates. Filters travel as one
base64'd protobuf — same wire format as the QR config and IndexedDB
state.

Cache invalidation: extractor publishes `jobs:invalidate`; api bumps an
in-process generation counter that participates in the cache key, so
all entries become misses without scanning.

### `JobView` response shape

```json
{
  "id": "0123abcd…",
  "title": "前端工程師",
  "company": null,
  "location": {"city": "台北市", "district": "信義區", "remote": false},
  "job_type": "full_time",
  "pay": {"min": 50000, "max": 70000, "period": "monthly", "raw": "5-7萬"},
  "requirements": {
    "skills":     [{"name": "React", "years_min": 2}],
    "experience": [{"role": "前端工程師", "years_min": 3}],
    "languages":  [{"name": "英文", "level": "商用"}]
  },
  "tags": ["遠端可", "急徵"],
  "posted_at": "2026-05-09T10:30:00+08:00",
  "source_url": "https://www.threads.com/@xxx/post/...",
  "author": {"handle": "@xxx", "name": "X 公司"}
}
```

## Frontend

Mobile-first React + Vite + Tailwind. Sidebar collapses to a bottom
sheet under 768px.

### Filter sidebar

- Profile dropdown (unlimited saved profiles, switchable, rename/delete)
- Cities multi-select + remote toggle
- Pay range + period selector
- Recency (24h / 7d / 30d)
- Job type checkboxes
- Free-text keyword search (Postgres tsvector)
- Skill rows: each is `[skill ▼] ≤ [years] [×]`, add unlimited
- Experience rows: same shape over roles
- Hide-spam toggle (default on, threshold 0.7)

### Local state (Zustand → IndexedDB)

```protobuf
message Config {
  uint32   version           = 1;
  repeated Profile profiles  = 2;     // unlimited
  string   active_profile_id = 3;
  repeated bytes favorites   = 4;     // global, 8-byte job ids
}
message Profile {
  string  id      = 1;                // ULID, client-generated
  string  name    = 2;                // "前端工作", "週末兼職"
  Filters filters = 3;
}
```

`seen_job_ids` is ephemeral, capped at 5000 LRU, NOT in the QR payload.
Seen jobs render dimmed with a 「已看」 tag, not hidden.

### QR transfer

- Export: protobuf → base64url → QR (high error correction, ~2.9KB
  capacity). Show byte count; warn at 2.5KB. If oversized, offer a
  `.bin` file download instead.
- Import: camera → `BarcodeDetector` (with `@zxing/browser` fallback) →
  decode → diff against current config → confirm overwrite → write to
  IndexedDB.

### Pages

- `/`         — Browse (virtualized infinite scroll, prefetch at -3)
- `/job/:id`  — Detail with full requirements + "Open on Threads" link
- `/settings` — Theme, QR import/export, profile management

### PWA

`vite-plugin-pwa`: `/api/jobs` network-first 60s, `/api/skills`
stale-while-revalidate, static assets precached. Installable manifest
with `脆找工作` name and icon set.

## Deployment

```yaml
services:
  caddy:      # ACME for query.tw, routes / → api
  api:        # Go binary, embeds SPA, 2 replicas
  scraper:    # Go + Playwright base, singleton, internal cron
  extractor:  # Go binary, N replicas (start at 2)
  postgres:   # 16, daily pg_dump to /backups
  redis:      # 7, AOF on
```

Secrets via `.env` mounted into compose:
`DEEPSEEK_API_KEY`, `THREADS_BURNER_USER`, `THREADS_BURNER_PASS`,
`POSTGRES_PASSWORD`, `ADMIN_BASIC_AUTH`.

## Observability

- slog JSON to stdout, rotated by docker
- Prometheus `/metrics` on every binary: queue depth, ingestion lag,
  LLM spend running sum, extraction error rate, query p50/p95, cache
  hit ratio
- Daily report cron writes to `daily_reports` (posts/jobs ingested,
  spam ratio, top new skills awaiting review, LLM cost). Admin UI
  shows last 30 days.

## Testing strategy

- **Unit** — pay parsing, dedup keying, filter→SQL builder, protobuf
  round-trip
- **Integration** — Postgres + Redis via testcontainers-go. Cover
  filter SQL on realistic fixtures and pagination invariants (no
  skips/duplicates under concurrent insert). No mocked DB tests.
- **Extraction quality** — `make eval` over ~50 hand-labeled real
  Threads posts; tracks precision/recall on title/pay/location and
  spam classification; re-run on prompt changes.
- **Frontend** — Playwright component tests for filter↔URL round-trip,
  QR export/import round-trip (programmatic decode, no camera),
  profile CRUD.

## Out of scope for MVP

- Email/push alerts on new matches
- Login or cross-device sync (QR replaces it)
- Employer/poster verification
- Salary analytics
- RSS, weekly digest, application-tracker, Threads browser extension
  (parking lot from "what else can we do?")
