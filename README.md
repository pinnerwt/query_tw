# 脆找工作 (cui-zhao-gongzuo)

A zh-TW PWA that surfaces job postings from Threads.com (`徵才` / `找人`).
Plan: [`docs/plans/2026-05-09-cui-zhao-gongzuo-plan.md`](docs/plans/2026-05-09-cui-zhao-gongzuo-plan.md).

## Stack

- **Backend**: Go 1.22, chi router, pgx, single `api` binary that also embeds the
  SPA bundle via `STATIC_DIR`.
- **DB**: PostgreSQL 16, hand-rolled migrations runner (`internal/db`).
- **Cache/queue**: Redis 7 (used by the scraper/extractor pipeline).
- **Frontend**: Vite + React 18 + Tailwind, TanStack Query, Zustand,
  IndexedDB-persisted config, vite-plugin-pwa, `react-virtuoso`, `qrcode`,
  `@zxing/browser`.
- **Pipeline**: `cmd/extractor` ships with `--seed` mode that loads
  `fixtures/jobs.json` directly. The DeepSeek client + persistence
  (`internal/extract`) is wired and ready; live scraper (Playwright +
  Threads.com) is left as a placeholder per plan Phase 7.

## Run locally

```sh
# Bring up postgres + redis + api, then seed fixtures
make up
docker compose -f deploy/docker-compose.yml run --rm seeder

# Browse: http://localhost:8080
# API:    http://localhost:8080/api/jobs
```

`make test` runs the Go tests; `cd web && BASE_URL=http://localhost:8080 npm run e2e`
runs the Playwright suite.

## Deploy to query.tw

The deploy script requires `ssh monitor` access:

```sh
./deploy/deploy-monitor.sh        # rsync + compose up
```

The monitor host runs Traefik (network `traefik-web`); the api container
joins that network and gets routed by Traefik labels for `Host(query.tw)`,
so no port is bound on the host. TLS is provisioned by the host's existing
letsencrypt resolver.

## What's included vs. plan

Implemented end-to-end:

- Schema, migrations, seed dictionaries (skills/roles), 15 fixture posts
- API: `/healthz`, `/api/jobs` (filtered, keyset paginated, hydrated),
  `/api/jobs/:id`, `/api/skills`, `/api/roles`, `/api/cities`
- Filters wire format (base64-encoded JSON; see deviation note below)
- Frontend: profile CRUD, collapsible sidebar (desktop) / bottom-sheet (mobile),
  cities/pay/recency/job-type/keyword/skills/experience/spam controls,
  virtualized infinite-scroll job list with favorite + seen, detail page,
  settings with theme + QR export + QR import + clear-data
- Extractor: DeepSeek client with structured output and retries, system prompt
  builder with cached dictionaries, atomic persistence with new-skill candidates
- Local docker-compose stack with the API + seeder
- Playwright e2e covering: load + sidebar collapsible, city filter narrows
  results, healthz, /api/jobs, /api/skills + /api/roles + /api/cities, profile
  CRUD, QR programmatic round-trip — all 7 tests pass on both desktop and mobile
  viewports

Deviations from the plan:

- **Wire format**: the plan specifies protobuf for filters/QR/IndexedDB.
  This environment had no `protoc`/`buf` toolchain, so the implementation
  uses base64url-encoded JSON instead. Same role (compact, transferable,
  size-bounded), same Filters / Config / Profile shape, same QR
  applicability — only the encoding changed. Swapping to protobuf is a
  drop-in replacement once toolchain is available; see `internal/filters`
  and `web/src/lib/filtersWire.ts`, `web/src/lib/qrPayload.ts`.
- **Live scraper**: Phase 7 (Playwright + Threads.com login) is not
  exercised; the data path is exercised via `cmd/extractor --seed`.
- **Eval harness, daily report cron, admin endpoints**: not implemented in
  this iteration; the data model has the JSONB column to carry raw LLM I/O
  (`posts.raw_extraction`).

## Layout

```
cmd/{api,scraper,extractor}     Go binaries
internal/
  config/    env loader
  db/        pgxpool + migrations runner
  domain/    JobView and friends
  filters/   base64-JSON decode + SQL builder (with keyset cursor)
  jobsrv/    repo + handler for /api/jobs
  skillsrv/  /api/skills, /api/roles, /api/cities
  extract/   DeepSeek client, prompt builder, atomic persistence
migrations/  *.up.sql / *.down.sql
fixtures/    canned LLM extractions for `extractor --seed`
web/         Vite React app
deploy/      docker-compose + Dockerfiles + Caddyfile + deploy script
```
