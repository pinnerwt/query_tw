# 脆找工作 (cui-zhao-gongzuo) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MVP zh-TW PWA that ingests Threads.com `徵才`/`找人` posts hourly, extracts structured jobs via DeepSeek, and serves them through a Go API to a React filter UI with QR-transferable local config.

**Architecture:** Three Go binaries (`api`, `scraper`, `extractor`) sharing one monorepo, backed by Postgres + Redis, fronted by Caddy. Frontend is React + Vite + Tailwind + Zustand + TanStack Query, IndexedDB-persisted, packaged as a PWA. Protobuf is the single wire format for filters / QR config / IndexedDB. Deployment via candy compose on host `monitor`.

**Tech Stack:** Go 1.22+, PostgreSQL 16, Redis 7, Playwright-go, DeepSeek (OpenAI-compatible), React 18, Vite, Tailwind, TanStack Query, Zustand, idb-keyval, vite-plugin-pwa, protobuf-ts, @zxing/browser. Testing: testcontainers-go, Playwright (FE), Vitest.

**Reference:** [`docs/plans/2026-05-09-cui-zhao-gongzuo-design.md`](./2026-05-09-cui-zhao-gongzuo-design.md)

---

## Repository layout (target)

```
/
  go.mod  go.sum
  cmd/
    api/main.go
    scraper/main.go
    extractor/main.go
  internal/
    config/         # env loading
    db/             # pg pool + migrations runner
    redis/          # client + helpers
    domain/         # Job, Post types
    filters/        # protobuf decode + SQL builder
    jobsrv/         # /api/jobs handler, keyset pagination
    skillsrv/       # /api/skills, /api/roles, /api/cities, admin
    cache/          # in-process LRU + generation counter
    metrics/        # prometheus
    extract/        # DeepSeek client + schema
    scrape/         # Playwright wrapper + stitching heuristics
    proto/          # generated Go protobuf
  migrations/       # *.up.sql / *.down.sql
  proto/            # *.proto sources
  web/              # Vite React app
    src/...
    proto/          # generated TS protobuf
  deploy/
    Caddyfile
    docker-compose.yml
    Dockerfile.api
    Dockerfile.scraper
    Dockerfile.extractor
  Makefile
  .env.example
  .gitignore
```

---

## Phase 0 — Scaffolding

### Task 0.1: Initialize Go module and monorepo skeleton

**Files:**
- Create: `go.mod`, `Makefile`, `.env.example`
- Create: `cmd/api/main.go`, `cmd/scraper/main.go`, `cmd/extractor/main.go` (placeholder `main` printing the binary name)
- Create: `internal/config/config.go`

**Step 1:** Run `go mod init github.com/pgi/matching`. Add `Makefile` targets `build`, `test`, `lint`, `up` (docker compose), `down`, `migrate`.

**Step 2:** Implement `internal/config/config.go` that loads env vars (`DATABASE_URL`, `REDIS_URL`, `DEEPSEEK_API_KEY`, `THREADS_BURNER_USER`, `THREADS_BURNER_PASS`, `ADMIN_BASIC_AUTH`, `LLM_DAILY_CAP_CENTS`) with defaults, exposing a `Load() (*Config, error)`.

**Step 3:** Each `cmd/*/main.go` calls `config.Load`, logs the binary name + commit SHA, and exits 0.

**Step 4:** `make build` produces three binaries under `bin/`. Verify they run.

**Step 5:** Commit `chore: scaffold go monorepo with three binaries and config loader`.

---

### Task 0.2: docker-compose stack (postgres, redis only for now)

**Files:**
- Create: `deploy/docker-compose.yml` (postgres 16, redis 7 with AOF, named volumes)
- Modify: `Makefile` (add `up-deps`, `down-deps`)

**Step 1:** Compose file boots `postgres:16` exposed on 5432 and `redis:7` on 6379, with healthchecks.

**Step 2:** `make up-deps && docker compose -f deploy/docker-compose.yml ps` shows both healthy.

**Step 3:** Commit `chore: docker-compose for postgres + redis dev deps`.

---

## Phase 1 — Data model

### Task 1.1: Migrations runner + first migration (posts, jobs, indexes)

**Files:**
- Create: `internal/db/db.go` (pgxpool wrapper + migrate runner)
- Create: `migrations/0001_posts_jobs.up.sql`, `migrations/0001_posts_jobs.down.sql`
- Create: `internal/db/db_test.go`

**Step 1: Write the failing test**

```go
func TestMigrate_UpThenDown(t *testing.T) {
  ctx := context.Background()
  pgC, dsn := testcontainers_postgres.Start(t)
  defer pgC.Terminate(ctx)

  pool, err := db.Open(ctx, dsn)
  require.NoError(t, err)
  require.NoError(t, db.MigrateUp(ctx, pool, "../../migrations"))

  var n int
  require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_name IN ('posts','jobs')`).Scan(&n))
  require.Equal(t, 2, n)

  require.NoError(t, db.MigrateDown(ctx, pool, "../../migrations"))
  require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_name IN ('posts','jobs')`).Scan(&n))
  require.Equal(t, 0, n)
}
```

**Step 2:** Run `go test ./internal/db/... -run TestMigrate_UpThenDown -v` → FAIL.

**Step 3:** Author `0001_posts_jobs.up.sql` exactly as in the design doc (posts + jobs tables + indexes). Author the matching `.down.sql` dropping in reverse order. Implement `db.Open`, `db.MigrateUp`, `db.MigrateDown` using `golang-migrate`'s `file` source and `pgx` driver.

**Step 4:** Re-run test → PASS.

**Step 5:** Commit `feat(db): migrations runner and posts/jobs schema`.

---

### Task 1.2: Side tables — job_skills, job_experience, job_languages, job_tags, skills, roles

**Files:**
- Create: `migrations/0002_skills_roles.up.sql`, `.down.sql`
- Modify: `internal/db/db_test.go` (assert all 8 tables exist, then 0 after down)

**Step 1:** Update the assertion to check 8 tables. Run → FAIL.

**Step 2:** Author the migration with `skills`, `roles` (id SERIAL, canonical UNIQUE, aliases TEXT[], approved BOOLEAN), then `job_skills`, `job_experience`, `job_languages`, `job_tags` referencing `jobs(id) ON DELETE CASCADE`. Add `job_skills (skill_id, years_min)` index.

**Step 3:** Test → PASS. Commit `feat(db): skill/role dictionaries and job side tables`.

---

### Task 1.3: Seed canonical skills/roles dictionaries

**Files:**
- Create: `migrations/0003_seed_dictionaries.up.sql`, `.down.sql`
- Create: `migrations/seed_skills.txt`, `migrations/seed_roles.txt`

**Step 1:** Author seed lists — start small: ~80 common tech skills (React, Vue, Go, Python, …), ~40 common roles (前端工程師, 後端工程師, UI/UX 設計師, 行政助理, …). The migration COPYs them in.

**Step 2:** Add a test that asserts at least 50 skills and 30 roles after migrate-up.

**Step 3:** Test → PASS. Commit `feat(db): seed canonical skill and role dictionaries`.

---

## Phase 2 — Protobuf wire formats

### Task 2.1: Define `Filters`, `Config`, `Profile`, `JobsExtraction` protos

**Files:**
- Create: `proto/config.proto`, `proto/extract.proto`
- Create: `Makefile` target `gen-proto` (invokes `buf generate` or `protoc` for both Go and TS)
- Create: `internal/proto/` (generated Go), `web/src/proto/` (generated TS — placeholder dir)

**Step 1:** Write `config.proto` containing `Filters`, `Profile`, `Config`, plus enums for `Period`, `JobType`. Mirror exactly the design doc shape, including `repeated SkillRow skills`, `repeated SkillRow experience` where `SkillRow{string name; uint32 years_min;}`.

**Step 2:** Write `extract.proto` with `JobsExtraction { repeated ExtractedJob jobs; float spam_score; repeated string new_skills; repeated string new_roles; }` and `ExtractedJob` mirroring the JSON the LLM emits. (Used internally as a typed shape; LLM sees JSON schema generated from this.)

**Step 3:** `make gen-proto` produces `internal/proto/*.pb.go` and `web/src/proto/*.ts`. Verify generated files compile (`go build ./...`).

**Step 4:** Commit `feat(proto): config and extract message definitions`.

---

### Task 2.2: Protobuf round-trip test

**Files:**
- Create: `internal/proto/proto_test.go`

**Step 1:** Test `MarshalConfig → UnmarshalConfig` preserves a sample with 3 profiles + 50 favorites; assert serialized size < 1500 bytes.

**Step 2:** Run → PASS (or FAIL & fix). Commit `test(proto): config round-trip and size budget`.

---

## Phase 3 — API skeleton

### Task 3.1: HTTP server + `/healthz` + `/metrics`

**Files:**
- Create: `cmd/api/server.go`, `cmd/api/server_test.go`
- Modify: `cmd/api/main.go`

**Step 1: Write the failing test**

```go
func TestHealthz(t *testing.T) {
  srv := NewServer(testDeps(t))
  rec := httptest.NewRecorder()
  srv.Handler.ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
  require.Equal(t, 200, rec.Code)
}
```

**Step 2:** FAIL. Implement `NewServer(*Deps) *http.Server` returning a `chi.Mux` with `/healthz` and `/metrics` (Prometheus). Wire into `main.go` with `http.ListenAndServe(":8080", ...)`.

**Step 3:** PASS. Commit `feat(api): http server with healthz and metrics`.

---

### Task 3.2: `/api/skills`, `/api/roles`, `/api/cities`

**Files:**
- Create: `internal/skillsrv/skillsrv.go`, `internal/skillsrv/skillsrv_test.go`
- Modify: `cmd/api/server.go` (mount routes)

**Step 1: Test** — seed a few skills/roles in a testcontainer Postgres, hit `/api/skills`, expect JSON `{skills:[{id,canonical,aliases},...]}` containing only `approved=true`. Cities returns a static `["台北市","新北市","桃園市","台中市","台南市","高雄市","其他"]`.

**Step 2:** FAIL → implement handlers reading from `skills` and `roles` (filtered by `approved=true`), with 5-min in-process cache.

**Step 3:** PASS. Commit `feat(api): skills, roles, cities endpoints with in-memory cache`.

---

## Phase 4 — Filter → SQL builder

### Task 4.1: Decode filters protobuf from base64 query param

**Files:**
- Create: `internal/filters/filters.go`, `internal/filters/filters_test.go`

**Step 1:** Test `Decode("base64...")` parses to a typed `*pb.Filters`; reject oversized (>4KB) and invalid base64 with distinct errors.

**Step 2:** Implement `Decode([]byte) (*pb.Filters, error)`. PASS. Commit `feat(filters): base64 protobuf decoder with size guard`.

---

### Task 4.2: Build keyset-paginated SQL from filters

**Files:**
- Create: `internal/filters/sql.go`, `internal/filters/sql_test.go`

**Step 1: Write failing test cases**, each asserting both the generated SQL string and the args slice for:
- Empty filters → `SELECT … WHERE spam_score < 0.7 ORDER BY posted_at DESC, id DESC LIMIT 31`
- Cities = ["台北市","新北市"], remote_ok = true → adds `(city = ANY($1) OR remote)` clause
- Pay min = 50000 monthly → adds `pay_max >= $N AND pay_period = 'monthly'`
- Two skill rows (React ≤2, Figma ≤4) → two `EXISTS (… COALESCE(years_min,0) <= $N)` subqueries
- Cursor `(2026-05-09T10:00:00Z, 0xabcd)` → adds `(j.posted_at, j.id) < ($N, $M)`
- `hide_spam=false` → threshold becomes 1.01

**Step 2:** Implement `BuildJobsQuery(*pb.Filters, *Cursor, limit int) (sql string, args []any)` using a `strings.Builder` and an args accumulator. PASS.

**Step 3:** Commit `feat(filters): SQL builder for filter set with keyset pagination`.

**Notes:**
- Use Postgres `simple` text-search config for `keyword` (zh segmentation is out of scope; tsvector built from title/tags/raw_excerpt at insert time).
- `years_min` filter semantics: `EXISTS (... AND COALESCE(years_min,0) <= $user_years)` — i.e. job's stated requirement must be ≤ what user has. If user has the skill at all but the job doesn't list it, the row matches via no-EXISTS-required (this means the slider is *only* used to filter jobs that *do* require that skill).

---

## Phase 5 — `/api/jobs` endpoint

### Task 5.1: Job repository with row→`JobView` mapping

**Files:**
- Create: `internal/jobsrv/repo.go`, `internal/jobsrv/repo_test.go`

**Step 1:** Test inserts a post + 2 jobs with side-table rows in a testcontainer DB, calls `repo.List(ctx, sql, args)`, expects shaped `[]JobView` with skill/experience/language arrays correctly hydrated.

**Step 2:** Implement using a single SQL with `array_agg` over LEFT JOINs, or two queries (jobs first, then a second batched query for side tables keyed by job_id) — prefer the second for clarity. PASS.

**Step 3:** Commit `feat(jobsrv): repository with hydrated JobView`.

---

### Task 5.2: `/api/jobs` handler with cursor encoding

**Files:**
- Create: `internal/jobsrv/handler.go`, `internal/jobsrv/handler_test.go`
- Modify: `cmd/api/server.go`

**Step 1:** End-to-end test against testcontainer: seed 35 jobs across 3 hours, call `/api/jobs?limit=10`, expect 10 jobs and a `next_cursor`; call again with cursor, expect 10 more without overlap; insert a brand-new job between calls and assert it does *not* appear in either page (keyset invariant).

**Step 2:** Implement: decode filters → build SQL → run → trim to `limit`, generate `next_cursor` from row[limit] if returned. Encode cursor as `base64(uvarint(unix_micros) + 16-byte job id)`.

**Step 3:** PASS. Commit `feat(api): /api/jobs with cursor pagination`.

---

### Task 5.3: Redis cache + invalidation generation

**Files:**
- Create: `internal/cache/cache.go`, `internal/cache/cache_test.go`
- Modify: `internal/jobsrv/handler.go` (wrap repo in cache)

**Step 1:** Test: two consecutive identical requests show 1 DB hit, 1 cache hit; after `cache.Bump()`, next request DB-hits again; pubsub on `jobs:invalidate` triggers `Bump()`.

**Step 2:** Implement an in-process `groupcache`-style LRU keyed by `gen|filters_hash|cursor`, TTL 60s, max 256 entries. Subscribe on startup to `jobs:invalidate`.

**Step 3:** PASS. Commit `feat(api): in-process LRU with redis-pubsub invalidation`.

---

## Phase 6 — Extractor

### Task 6.1: DeepSeek client with JSON-schema response

**Files:**
- Create: `internal/extract/deepseek.go`, `internal/extract/deepseek_test.go`

**Step 1:** Test using `httptest.Server` mocking the OpenAI-compatible endpoint: returns canned JSON; assert client decodes into `JobsExtraction`. Test 400/429/timeout retry behavior (3 attempts with backoff).

**Step 2:** Implement `Client.Extract(ctx, text string) (*JobsExtraction, tokenUsage, error)` calling `/v1/chat/completions` with `response_format: {type: "json_schema", json_schema: ...}`, system prompt loaded from `internal/extract/prompt.go` (skills/roles dictionaries injected at startup, refresh every 1h).

**Step 3:** PASS. Commit `feat(extract): deepseek client with structured output and retries`.

---

### Task 6.2: System prompt builder

**Files:**
- Create: `internal/extract/prompt.go`, `internal/extract/prompt_test.go`
- Create: `internal/extract/prompt_template.txt`

**Step 1:** Test that the built prompt contains all approved skill canonicals and role canonicals, the schema description, and the `spam_score` rubric, and stays under ~6KB.

**Step 2:** Implement `BuildPrompt(skills []string, roles []string) string` reading the template and substituting placeholders.

**Step 3:** PASS. Commit `feat(extract): system prompt with cached dictionaries`.

---

### Task 6.3: Persistence — `posts` row + `jobs` rows + dictionary candidates

**Files:**
- Create: `internal/extract/persist.go`, `internal/extract/persist_test.go`

**Step 1:** Test: given a `JobsExtraction` with 2 jobs and 1 `_new_skill`, persistence writes 1 post (job_count=2), 2 jobs, side-table rows, 1 new skill row with `approved=false`. A second persist of the same post URL is a no-op (ON CONFLICT DO NOTHING on `posts.url`).

**Step 2:** Implement `Persist(ctx, db, postMeta, *JobsExtraction) error` in one transaction. Resolve canonical skill_id by `LOWER(canonical) = LOWER($1)` or alias match; if not found, INSERT skill with `approved=false` and use returned id.

**Step 3:** PASS. Commit `feat(extract): atomic persistence with new-skill candidate insertion`.

---

### Task 6.4: Extractor worker loop

**Files:**
- Create: `cmd/extractor/main.go` (replace placeholder), `cmd/extractor/worker_test.go`

**Step 1:** Test using a Redis testcontainer + Postgres testcontainer: RPUSH a fake post, run worker for 1 second, expect Postgres to contain the persisted post + jobs and `jobs:invalidate` PUBLISH count == 1.

**Step 2:** Implement loop: BLPOP `extract_queue` (30s timeout) → check daily LLM cap (`INCRBY llm_spend_cents:YYYY-MM-DD`; if over, sleep 5min) → call `extract.Client.Extract` → `extract.Persist` → `PUBLISH jobs:invalidate 1`. Add 3-attempt retry; on final failure mark post `extraction_failed=true` (add column in a new migration if needed).

**Step 3:** PASS. Commit `feat(extractor): worker loop with retries, daily cost cap, invalidation`.

---

## Phase 7 — Scraper

### Task 7.1: Playwright wrapper + login bootstrap

**Files:**
- Create: `internal/scrape/browser.go`, `internal/scrape/browser_test.go`
- Modify: `cmd/scraper/main.go`

**Step 1:** Test (smoke) that we can launch a headless browser, navigate to `https://www.threads.com/`, and screenshot. Skip in CI by default; run manually with `THREADS_TEST=1`.

**Step 2:** Implement persistent-context launcher (saves cookies under `/data/playwright`), with login routine: if not logged in, fill burner credentials. Expose `Browser.Page() (Page, func())`.

**Step 3:** Commit `feat(scrape): playwright launcher with persistent login`.

---

### Task 7.2: Search page scraper with stop-on-known and stitch heuristic

**Files:**
- Create: `internal/scrape/search.go`, `internal/scrape/search_test.go`

**Step 1:** Test against captured HTML fixtures (no live Threads): given a fixture page with 30 cards, `ParseCards(html)` returns 30 records with url, author, timestamp, snippet, and `looksTruncated bool`. Verify the truncation heuristic flags exactly the expected cards.

**Step 2:** Implement `ParseCards(html string) []Card` using `goquery`. Detect truncation via suffix `...` or substring `"詳情見留言"|"見留言"|"私訊"`.

**Step 3:** Implement `ScrapeQuery(ctx, browser, query string, knownSet redis.Set, queue redis.List)` that scrolls until 3 consecutive known posts, max 200 scrolls, max 10min wall clock, opening detail pages for truncated snippets to stitch own-author replies.

**Step 4:** Commit `feat(scrape): search page parsing with stitch heuristic`.

---

### Task 7.3: Hourly scheduler + scraper main

**Files:**
- Modify: `cmd/scraper/main.go`

**Step 1:** Implement: on startup wait 60s, then loop with ticker 60min ± 5min jitter; for each `query in ["徵才","找人"]` call `ScrapeQuery`. Expose `/metrics` and `/healthz` on :8081.

**Step 2:** Manual e2e (documented in plan, not automated): `make scraper-once` runs one cycle and prints queue depth.

**Step 3:** Commit `feat(scraper): hourly scheduler with jitter and per-query loop`.

---

## Phase 8 — Admin

### Task 8.1: Admin endpoints (basic auth)

**Files:**
- Create: `internal/skillsrv/admin.go`, `internal/skillsrv/admin_test.go`

**Step 1:** Tests for `/admin/skills/pending` (lists `approved=false`), `/admin/skills/approve` (sets approved=true and merges aliases), `/admin/skills/reject` (deletes the row + cascades), `/admin/posts/:id/raw` (returns the LLM input/output for debugging — requires storing it; add a `raw_extraction` JSONB column in a new migration). All require basic auth via `ADMIN_BASIC_AUTH` env.

**Step 2:** Implement. PASS. Commit `feat(admin): skill review and raw extraction endpoints`.

---

## Phase 9 — Frontend scaffolding

### Task 9.1: Vite + React + Tailwind + PWA bootstrap

**Files:**
- Create: `web/` (run `npm create vite@latest web -- --template react-ts`)
- Modify: `web/vite.config.ts` (add `vite-plugin-pwa`, set base, proxy `/api` → 8080 in dev)
- Create: `web/tailwind.config.js`, `web/postcss.config.js`, `web/src/index.css`

**Step 1:** Scaffold via Vite. Add Tailwind per official guide. Add `vite-plugin-pwa` with manifest `{name: "脆找工作", short_name: "脆找工作", lang: "zh-TW", icons: [...]}`.

**Step 2:** `npm run build` succeeds, output includes `manifest.webmanifest`, `sw.js`. Commit `feat(web): vite + react + tailwind + pwa scaffold`.

---

### Task 9.2: API client + TanStack Query

**Files:**
- Create: `web/src/api/client.ts`, `web/src/api/jobs.ts`, `web/src/api/dictionaries.ts`
- Modify: `web/src/main.tsx` (add `QueryClientProvider`)

**Step 1:** Implement `fetchJobs(filtersBase64, cursor) → Promise<JobsPage>` and `useJobsInfinite(filters)` returning a `useInfiniteQuery` with `getNextPageParam: page => page.next_cursor ?? undefined`. Likewise `useSkills()`, `useRoles()`, `useCities()` with `staleTime: 5*60_000`.

**Step 2:** Manual smoke: in dev, page loads `/api/jobs` proxied to backend.

**Step 3:** Commit `feat(web): api client and tanstack-query hooks`.

---

### Task 9.3: Zustand config store with IndexedDB persistence

**Files:**
- Create: `web/src/state/configStore.ts`, `web/src/state/configStore.test.ts`
- Create: `web/src/state/seenStore.ts`

**Step 1: Tests (Vitest)** — store starts with one default profile if IndexedDB empty; mutations (`addProfile`, `renameProfile`, `deleteProfile`, `setActiveProfile`, `updateFilters`, `toggleFavorite`) round-trip through `idb-keyval` mocked with `fake-indexeddb`.

**Step 2:** Implement Zustand store; protobuf-encode on every change with debounce 250ms; persist key `config.v1`. `seenStore` is a separate store: `Set<jobIdHex>`, capped at 5000 LRU, persisted under `seen.v1`.

**Step 3:** PASS. Commit `feat(web): zustand store for config and seen-jobs persisted to indexeddb`.

---

## Phase 10 — Frontend UI

### Task 10.1: App shell + routing + zh-TW i18n

**Files:**
- Create: `web/src/App.tsx`, `web/src/pages/Browse.tsx`, `web/src/pages/Detail.tsx`, `web/src/pages/Settings.tsx`
- Create: `web/src/i18n/zh-TW.json`, `web/src/i18n/index.ts`

**Step 1:** Set up `react-router-dom` routes `/`, `/job/:id`, `/settings`. i18n via a tiny `t(key)` reading from JSON (no need for full i18next at MVP).

**Step 2:** Each page renders a placeholder with the localized title.

**Step 3:** Commit `feat(web): routing skeleton with zh-TW strings`.

---

### Task 10.2: Filter sidebar — base controls

**Files:**
- Create: `web/src/components/sidebar/Sidebar.tsx`
- Create: `web/src/components/sidebar/CitiesPicker.tsx`, `PayRange.tsx`, `RecencyTabs.tsx`, `JobTypeChecks.tsx`, `KeywordSearch.tsx`, `HideSpamToggle.tsx`

**Step 1:** Each control reads/writes `useConfigStore.getState().active.filters.<field>`. On <768px the sidebar becomes a bottom sheet (Tailwind classes + `useMediaQuery`).

**Step 2:** Smoke test in dev: changing a control updates the URL (filters base64) via `useEffect` syncing store → URL params.

**Step 3:** Commit `feat(web): sidebar with base filter controls`.

---

### Task 10.3: Skill / experience rows

**Files:**
- Create: `web/src/components/sidebar/SkillRow.tsx`, `ExperienceRow.tsx`, `SkillRows.tsx`, `ExperienceRows.tsx`

**Step 1:** Each row has a searchable dropdown (use `cmdk` or `downshift`) populated from `useSkills()` / `useRoles()`, an `<input type="range" min=0 max=10>` for years, and a remove button. Adding a row pushes to `filters.skills`/`filters.experience` arrays in the active profile.

**Step 2:** Manual: add 3 rows, change sliders, see filters base64 change in URL.

**Step 3:** Commit `feat(web): unlimited skill and experience filter rows`.

---

### Task 10.4: Profile selector

**Files:**
- Create: `web/src/components/sidebar/ProfileSelect.tsx`

**Step 1:** Dropdown listing `config.profiles` with an indicator on `active_profile_id`. Buttons: New (creates ULID + empty filters), Rename (inline edit), Delete (confirm modal — disable when only 1 profile remains).

**Step 2:** Switching profiles swaps the entire filter pane immediately (Zustand selector).

**Step 3:** Commit `feat(web): profile selector with CRUD`.

---

### Task 10.5: Job list — virtualized infinite scroll

**Files:**
- Create: `web/src/components/jobs/JobCard.tsx`, `JobList.tsx`, `FavoriteButton.tsx`

**Step 1:** Use `react-virtuoso` with `useInfiniteQuery`'s pages flattened. `endReached` triggers `fetchNextPage`. Prefetch when within 3 items of end (Virtuoso `increaseViewportBy={{bottom: 600}}`).

**Step 2:** `JobCard` renders title, location, pay (formatted via `formatPay({min,max,period,raw})`), top 2 skill chips, relative time (`dayjs/relativeTime` zh-tw locale), favorite star, "已看" tag if in `seenStore`. Visiting `/job/:id` adds to `seenStore`.

**Step 3:** Commit `feat(web): virtualized infinite job list with favorite and seen markers`.

---

### Task 10.6: Job detail page

**Files:**
- Modify: `web/src/pages/Detail.tsx`
- Create: `web/src/api/job.ts` (`fetchJob(id)`)

**Step 1:** Render full `JobView` — all skills/experience/languages/tags, pay, location, posted_at, "Open on Threads" deep link to `source_url`. Adds id to `seenStore` on mount.

**Step 2:** Commit `feat(web): job detail page with source link`.

---

## Phase 11 — QR transfer

### Task 11.1: QR export

**Files:**
- Create: `web/src/components/config/QrExport.tsx`
- Create: `web/src/lib/qrPayload.ts`, `web/src/lib/qrPayload.test.ts`

**Step 1:** Test `encodePayload(config)` returns base64url string, decodes back to identical config.

**Step 2:** Implement using `qrcode` lib for rendering; show byte count and a yellow warning ≥2.5KB. If >2.9KB, hide QR and show "Export as file" button that downloads `config.bin`.

**Step 3:** Commit `feat(web): qr export with size guard and file fallback`.

---

### Task 11.2: QR import

**Files:**
- Create: `web/src/components/config/QrImport.tsx`

**Step 1:** Use `BarcodeDetector` if `'BarcodeDetector' in window`, else `@zxing/browser` `BrowserMultiFormatReader`. Camera permission UX (explain why), live preview with `<video>`.

**Step 2:** On detect → decode → parse protobuf → diff: show "Replace your X profiles + Y favorites with imported A profiles + B favorites?" → confirm → write to store. Reject if proto fails to parse.

**Step 3:** Commit `feat(web): qr import with camera scan and overwrite confirm`.

---

### Task 11.3: Settings page wiring

**Files:**
- Modify: `web/src/pages/Settings.tsx`

**Step 1:** Mount QrExport, QrImport, theme toggle (light/dark/system, persisted in `localStorage`), and a "Clear all data" button (wipes IndexedDB after confirm).

**Step 2:** Commit `feat(web): settings page with config transfer and theme`.

---

## Phase 12 — Observability & cost

### Task 12.1: Prometheus metrics on all binaries

**Files:**
- Create: `internal/metrics/metrics.go`
- Modify: `cmd/api/server.go`, `cmd/scraper/main.go`, `cmd/extractor/main.go`

**Step 1:** Define counters/histograms: `ingest_queue_depth` (gauge, sampled), `extract_attempts_total{status}`, `extract_token_cost_cents_total`, `http_requests_total{path,status}`, `http_request_duration_seconds`, `cache_hits_total{layer}`, `scrape_pages_scraped_total`, `scrape_consecutive_known`.

**Step 2:** Wire all three binaries to expose `/metrics`.

**Step 3:** Commit `feat(metrics): prometheus instrumentation across binaries`.

---

### Task 12.2: Daily report job

**Files:**
- Create: `migrations/0004_daily_reports.up.sql/.down.sql`
- Create: `internal/report/daily.go`, `internal/report/daily_test.go`
- Modify: `cmd/api/main.go` (cron at 09:00 Asia/Taipei)

**Step 1:** Test computes the report from a fixture day: posts ingested, jobs inserted, spam ratio, top 5 new candidate skills, total LLM cost cents.

**Step 2:** Implement; persist to `daily_reports(date PK, payload JSONB)`. Add `/admin/reports?days=30` endpoint returning the latest N rows.

**Step 3:** Commit `feat(report): nightly ingestion report with admin endpoint`.

---

## Phase 13 — Deployment

### Task 13.1: Dockerfiles for each binary

**Files:**
- Create: `deploy/Dockerfile.api`, `deploy/Dockerfile.scraper`, `deploy/Dockerfile.extractor`

**Step 1:** API and extractor: distroless static. Scraper: `mcr.microsoft.com/playwright:v1.43.0-jammy` base + Go binary. API embeds the SPA via `embed.FS` from `web/dist`.

**Step 2:** `make images` builds all three. Commit `chore: dockerfiles for api, scraper, extractor`.

---

### Task 13.2: Caddyfile and full compose

**Files:**
- Create: `deploy/Caddyfile`
- Modify: `deploy/docker-compose.yml`

**Step 1:** Caddy: `query.tw { reverse_proxy api:8080 }` with auto-HTTPS. Compose adds `caddy`, `api` (2 replicas), `scraper` (1), `extractor` (2), with healthchecks and a `depends_on` of postgres/redis.

**Step 2:** Local smoke test: `make up` boots all services; `curl http://localhost/healthz` returns 200.

**Step 3:** Commit `chore(deploy): caddy and full compose stack`.

---

### Task 13.3: Deploy script for `monitor`

**Files:**
- Create: `deploy/deploy.sh`

**Step 1:** Script `rsync`s repo to `monitor:/srv/cuizhao`, runs `docker compose build && docker compose up -d`, then runs `docker compose exec api ./api migrate-up`.

**Step 2:** Document in `README.md` the one-time setup: `.env` on host, DNS for `query.tw`, burner Threads login bootstrap (`docker compose run --rm scraper login`).

**Step 3:** Commit `chore(deploy): deploy script and ops runbook`.

---

## Phase 14 — Quality gates before launch

### Task 14.1: Extraction eval harness

**Files:**
- Create: `evals/fixtures/*.json` (50 hand-labeled real Threads posts; gather from a manual scraper run)
- Create: `evals/run.go`
- Modify: `Makefile` (target `eval`)

**Step 1:** `make eval` runs each fixture through the live extractor, compares to gold labels for: title presence, pay min/max within ±10%, city match, spam classification (≥0.7 vs <0.7). Report precision/recall per field.

**Step 2:** Commit `chore(eval): extraction quality harness with 50 labeled posts`.

---

### Task 14.2: End-to-end Playwright tests

**Files:**
- Create: `web/e2e/browse.spec.ts`, `e2e/qr-roundtrip.spec.ts`, `e2e/profiles.spec.ts`

**Step 1:** Run against a real backend with a seeded DB (script in `evals/seed_e2e.go`): assert 30 jobs render, filter changes update the URL, switching profile swaps the filter state, QR export → import (programmatic decode, no camera) round-trips identically, profile delete works.

**Step 2:** Commit `test(e2e): playwright tests for browse, qr, profiles`.

---

## Definition of done for MVP

- [ ] `make up` boots the stack locally; `curl /healthz` returns 200.
- [ ] One scraper cycle ingests ≥10 fresh jobs from live Threads.
- [ ] `/api/jobs` returns hydrated `JobView`s with cursor pagination invariants holding under concurrent insert.
- [ ] Frontend installable as PWA, sidebar filters work, profile CRUD works, QR export/import round-trips.
- [ ] Eval suite reports ≥80% precision on title and ≥70% on pay parsing.
- [ ] Deployed to `monitor`, query.tw resolves, Caddy issues TLS, daily report job has run once.

---

## Out of scope for this plan

Email/push alerts, login/cross-device-sync (QR replaces it), employer accounts, salary analytics, RSS/digest, Threads browser extension. Track in `docs/parking-lot.md` once we hit MVP.
