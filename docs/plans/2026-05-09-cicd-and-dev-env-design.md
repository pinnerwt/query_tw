# CI/CD + dev environment — design

Date: 2026-05-09
Repo: pinnerwt/query_tw
Status: design approved, awaiting implementation plan

## Goals

1. Run automated lint/test on every PR and on push to `master` / `dev`.
2. Deploy `master` → `query.tw` (prod) automatically.
3. Add a `dev` branch that deploys to `dev.query.tw` for previewing experimental features, on the same `api_server`.
4. Dev environment is fully isolated from prod state (separate database, separate redis logical db) but reuses prod's postgres/redis containers and nginx.

## Branch model

| Branch | Deploys to | Notes |
|---|---|---|
| `master` | `query.tw` | Production. Protected — merges via PR from `dev` (or hotfix branches). |
| `dev` | `dev.query.tw` | Long-lived. Experimental features land here for preview before promotion to master. |
| feature branches | nothing | CI runs only. Merge to `dev` to preview. |

## CI — `.github/workflows/ci.yml`

Triggered on `pull_request` and `push` to `master` and `dev`.

Two jobs run in parallel, each path-filtered:

### `go-checks`
Runs when any of these change: `cmd/**`, `internal/**`, `migrations/**`, `go.mod`, `go.sum`, `.github/workflows/ci.yml`.

Steps:
- `actions/setup-go@v5` reading version from `go.mod`
- `gofmt -l .` — fail if output is non-empty
- `go vet ./...`
- `go test ./...`

### `web-checks`
Runs when `web/**` or `.github/workflows/ci.yml` change.

Steps:
- `actions/setup-node@v4` (Node 20, npm cache from `web/package-lock.json`)
- `npm ci` in `web/`
- `npm run lint` (eslint) — add scripts/config if missing
- `npm run typecheck` (`tsc --noEmit`) — add script if missing
- `npm run build`

No e2e in CI (intentional — too slow for the value at this stage).

## CD — `.github/workflows/deploy.yml`

Triggered on `push` to `master` or `dev`, after CI passes (combined workflow with `needs: [go-checks, web-checks]` so we don't pay for `workflow_run` indirection).

### `deploy` job

Runs on `ubuntu-latest`. Concurrency group `deploy-${{ github.ref }}`, `cancel-in-progress: true`.

Steps:
1. `actions/checkout@v4`
2. Configure SSH: write `secrets.DEPLOY_SSH_KEY` to `~/.ssh/id_ed25519`, write `secrets.DEPLOY_KNOWN_HOSTS` to `~/.ssh/known_hosts`.
3. Compute target env: `master` → `prod`, `dev` → `dev`.
4. SSH to `ubuntu@query.tw`, run:
   ```sh
   cd /home/ubuntu/cuizhao{,-dev} \
     && git fetch origin \
     && git checkout <sha> \
     && ./deploy/deploy-monitor.sh <env>
   ```

### Required GitHub secrets

- `DEPLOY_SSH_KEY` — newly generated ed25519 private key, paired with an entry in `ubuntu@api_server:~/.ssh/authorized_keys`. Restrict the key with a `command="..."` forced-command if we want extra hardening (out of scope for v1).
- `DEPLOY_KNOWN_HOSTS` — output of `ssh-keyscan query.tw` (commit-time pin so MITM gets noticed).

### Required server-side prep

- Clone the repo a second time at `/home/ubuntu/cuizhao-dev/` so both checkouts can be advanced independently. The deploy script's `cd` target is parameterised by env.
- Add the new SSH public key to `ubuntu@api_server:~/.ssh/authorized_keys`.

## Dev environment — server-side topology

Same `api_server` as prod, sharing the existing `deploy-nginx-1`, `postgres`, and `redis` containers. Dev brings up only its own application containers.

| Concern | Prod | Dev |
|---|---|---|
| Postgres container | `cuizhao-postgres-1` | (same) |
| Postgres database | `cuizhao` | `cuizhao_dev` (new, owned by `cuizhao` role) |
| Redis container | `cuizhao-redis-1` | (same) |
| Redis logical db | `0` | `1` |
| Compose project | `cuizhao` | `cuizhao-dev` |
| Compose file | `deploy/docker-compose.yml` | `deploy/docker-compose.dev.yml` |
| Host directory | `/home/ubuntu/cuizhao` | `/home/ubuntu/cuizhao-dev` |
| API container alias | `cuizhao-api` | `cuizhao-api-dev` |
| Nginx server_name | `query.tw` | `dev.query.tw` |
| Cron | `/etc/cron.d/cuizhao-scrape` | *none* |

### `deploy/docker-compose.dev.yml`

Declares only `api`, `extractor`, `scraper`. Postgres and redis are referenced via the `deploy_default` external network (joined as external). Env differs only by `DATABASE_URL` (db name `cuizhao_dev`), `REDIS_URL` (db `/1`), and the network alias `cuizhao-api-dev`. Scraper env on dev: `SCRAPE_QUERIES=徵才`, `MAX_JOBS=10`, no cron.

### `deploy/nginx-dev-query-tw.conf`

Structurally identical to `nginx-query-tw.conf`, with:
- `server_name dev.query.tw;`
- `proxy_pass http://cuizhao-api-dev:8080;`
- Markers `# CUIZHAO-DEV-NGINX-BLOCK-START` / `# CUIZHAO-DEV-NGINX-BLOCK-END`
- No basic-auth gate (per user decision).

### TLS / DNS

- Cloudflare DNS: add `dev` A/AAAA or CNAME pointing at the same target as `query.tw`, orange-cloud (proxied).
- Cert: cover both `query.tw` and `dev.query.tw`. If using Cloudflare-issued edge cert + Full SSL (matching current setup), no certbot work needed; CF auto-handles SAN. If using an origin cert, reissue with both names.

## `deploy-monitor.sh` — single script, env arg

Invocation: `./deploy/deploy-monitor.sh [prod|dev] [scrape|--reseed]`. `prod` is the default when omitted, so existing usage (`./deploy/deploy-monitor.sh`, `./deploy/deploy-monitor.sh scrape`) is unchanged.

The script picks env-specific values via a small dispatch at the top (compose project, compose file, host dir, network alias, nginx file, nginx markers, healthz host, cron-install on/off). The rest of the script — local `npm run build`, rsync, `docker compose build && up -d`, nginx in-place rewrite + reload, healthz probe via `--resolve` — is unchanged in shape.

### `--reseed` (dev only)

`./deploy/deploy-monitor.sh dev --reseed`:

1. SSH (or run locally on the server) `pg_dump --data-only --no-owner` of the prod `cuizhao` db, restricted to: `posts`, `jobs`, `skills`, `roles`, `job_skills`, `job_experience`, `job_languages`, `job_tags`, plus any seed tables. Use `--where` on `posts` to limit to last N days (default 14).
2. `TRUNCATE` the corresponding tables in `cuizhao_dev` (`RESTART IDENTITY CASCADE`).
3. `psql cuizhao_dev < dump.sql`.

No PII risk: all author handles are already public Threads handles.

The reseed is **manual only** — normal `dev` deploys preserve `cuizhao_dev`.

## Not in scope (v1)

- Playwright e2e in CI.
- Forced-command hardening of the deploy SSH key.
- Cert automation via certbot (Cloudflare edge cert is sufficient).
- Auto-promotion `dev` → `master` (PR-driven only).

## Risks & gotchas

- **`web/dist` baked into image**: prod gotcha already documented in `CLAUDE.md` applies to dev too. The dev compose still rebuilds the api image on each deploy, so this is fine — but worth carrying the rule forward.
- **Shared postgres**: a runaway dev migration that locks shared catalog tables would impact prod. Migrations on dev should be reviewed before merging the schema change to master, and ideally tested with `RUN_MIGRATIONS=0` first if risky.
- **Shared redis**: dev uses db `1`, prod uses `0`. The Go redis client connects via `REDIS_URL=...?db=1` (or path `/1`); confirm the URL format the app accepts before committing.
- **Cloudflare cache on dev**: same `--resolve` healthz pattern applies.
- **Two checkouts on the host**: `/home/ubuntu/cuizhao` and `/home/ubuntu/cuizhao-dev` will drift in untracked files (state.json, .env). The deploy step rsyncs those over, so they stay correct per branch.

## Open implementation questions (resolve in plan)

- Does the Go redis client accept db selection via URL (`redis://host:6379/1`) without code change? Inspect `internal/...` redis init.
- Confirm Node version used by `web/` (read `web/package.json` engines or `.nvmrc`) — design assumes Node 20.
- Confirm exact list of tables to dump for `--reseed` against current `migrations/`.
