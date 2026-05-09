# CI/CD + dev environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire GitHub Actions CI on every PR/push, auto-deploy `master` → `query.tw` and `dev` → `dev.query.tw`, and stand up an isolated dev environment on the same `api_server` host.

**Architecture:** One combined GH Actions workflow runs path-filtered Go and web checks, then a deploy job SSHes into `api_server` and invokes `./deploy/deploy-monitor.sh [prod|dev]`. The dev environment shares the existing postgres/redis/nginx containers but uses a separate `cuizhao_dev` database and redis db `1`, with its own `cuizhao-api-dev` network alias and `dev.query.tw` nginx vhost.

**Tech Stack:** GitHub Actions, Bash, Docker Compose, nginx, Postgres 16, Redis 7, Go 1.22, Vite/TypeScript (React).

**Reference design:** `docs/plans/2026-05-09-cicd-and-dev-env-design.md`.

**Verified preconditions (already audited from the repo):**
- Go redis client uses `redis.ParseURL` (`cmd/extractor/main.go:182`), so `redis://redis:6379/1` selects db 1 with no code change.
- `web/` already has `tsconfig.json` with `noEmit: true` and `strict: true`. Missing: `lint` and `typecheck` npm scripts, plus eslint config.
- Schema has 9 tables (`posts`, `jobs`, `skills`, `roles`, `job_skills`, `job_experience`, `job_languages`, `job_tags`, `daily_reports`) per `migrations/0001_init.up.sql`.
- The current `deploy-monitor.sh` already supports a `scrape` arg; we'll keep it backwards-compatible.

---

## Phase 1 — CI workflow (low risk, no infra changes)

### Task 1: Add `lint` and `typecheck` npm scripts to web

**Files:**
- Modify: `web/package.json`
- Create: `web/.eslintrc.cjs`
- Modify: `web/package.json` (add eslint deps)

**Step 1: Add eslint deps**

Run:
```sh
cd web && npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react eslint-plugin-react-hooks
```

**Step 2: Create eslint config**

Write `web/.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: { react: { version: 'detect' } },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', 'e2e', 'playwright-report', 'test-results'],
};
```

**Step 3: Add scripts to `web/package.json`**

Edit the `"scripts"` block to add:
```json
    "lint": "eslint 'src/**/*.{ts,tsx}'",
    "typecheck": "tsc --noEmit"
```

**Step 4: Verify locally**

Run:
```sh
cd web && npm run typecheck
cd web && npm run lint
cd web && npm run build
```

All three must exit 0. If lint fails on existing code, **do not auto-fix the source** — instead loosen rules in `.eslintrc.cjs` to warnings, or add file-level eslint-disable. The goal of this task is to establish the gate, not to mass-edit prior code.

**Step 5: Commit**

```sh
git add web/package.json web/package-lock.json web/.eslintrc.cjs
git commit -m "Add lint and typecheck npm scripts for CI"
```

---

### Task 2: Add Go format check Make target (optional helper)

**Files:**
- Modify: `Makefile`

**Step 1: Append a `fmt-check` target**

Add to `Makefile`:
```make
fmt-check:
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "gofmt issues:"; echo "$$out"; exit 1; fi
```

**Step 2: Verify**

```sh
make fmt-check
```

Expected: exit 0 (silent success). If it lists files, run `gofmt -w` on them as a separate commit, *not* part of this task.

**Step 3: Commit**

```sh
git add Makefile
git commit -m "Add fmt-check Make target for CI"
```

---

### Task 3: Write `.github/workflows/ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Write the workflow**

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [master, dev]

jobs:
  go-checks:
    name: go (lint + test)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
          cache: true
      - name: gofmt
        run: |
          out=$(gofmt -l .)
          if [ -n "$out" ]; then
            echo "::error::gofmt issues:"
            echo "$out"
            exit 1
          fi
      - run: go vet ./...
      - run: go test ./...

  web-checks:
    name: web (lint + typecheck + build)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build
```

**Note on path filters:** GH Actions does not skip a job whose triggers match — `paths` filters apply to the **workflow** trigger, not per-job. Splitting per-folder triggers cleanly requires either two workflows or `dorny/paths-filter`. We use `dorny/paths-filter` to keep one workflow:

Replace the steps above with this richer version (use this version as the final content):

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [master, dev]

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      go: ${{ steps.filter.outputs.go }}
      web: ${{ steps.filter.outputs.web }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            go:
              - 'cmd/**'
              - 'internal/**'
              - 'migrations/**'
              - 'go.mod'
              - 'go.sum'
              - '.github/workflows/ci.yml'
            web:
              - 'web/**'
              - '.github/workflows/ci.yml'

  go-checks:
    needs: changes
    if: needs.changes.outputs.go == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
          cache: true
      - name: gofmt
        run: |
          out=$(gofmt -l .)
          if [ -n "$out" ]; then
            echo "::error::gofmt issues:"
            echo "$out"
            exit 1
          fi
      - run: go vet ./...
      - run: go test ./...

  web-checks:
    needs: changes
    if: needs.changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build
```

**Step 2: Validate YAML locally**

```sh
python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml"))'
```
Expected: no output, exit 0.

**Step 3: Commit**

```sh
git add .github/workflows/ci.yml
git commit -m "Add CI workflow: path-filtered go and web checks"
```

**Step 4: Verify on a branch (not master yet)**

```sh
git checkout -b ci-bringup
git push -u origin ci-bringup
gh pr create --fill --base master
```

Open the PR in `gh pr view --web`. Both `go-checks` and `web-checks` should run and pass (or be skipped per filter). If they fail, fix and push; do NOT merge to master until green.

**Step 5: Merge or delete the bringup PR**

If green, you can either merge it (CI now lives on master) or close+delete the branch and re-land the workflow as part of a later commit. Recommended: merge it small.

---

## Phase 2 — Server-side prep for dev (one-time, manual)

These tasks change shared infrastructure. Read each step before running it.

### Task 4: Create `cuizhao_dev` database

**Step 1: SSH in and create the db**

```sh
ssh api_server 'sudo docker exec -i cuizhao-postgres-1 psql -U cuizhao -c "CREATE DATABASE cuizhao_dev OWNER cuizhao;"'
```

Expected: `CREATE DATABASE`. If it errors `already exists`, that's fine — proceed.

**Step 2: Verify**

```sh
ssh api_server 'sudo docker exec -i cuizhao-postgres-1 psql -U cuizhao -lqt | cut -d "|" -f 1 | grep -w cuizhao_dev'
```
Expected: `cuizhao_dev` echoed.

**Step 3: Sanity-check migrations will run**

This is a smoke test only. Don't actually migrate yet — Task 12 will do it via the api container.

```sh
ssh api_server 'sudo docker exec -i cuizhao-postgres-1 psql -U cuizhao -d cuizhao_dev -c "SELECT 1"'
```
Expected: `1`.

No commit (server-side only).

---

### Task 5: Clone repo into `/home/ubuntu/cuizhao-dev/`

**Step 1: Clone**

```sh
ssh api_server 'cd /home/ubuntu && git clone git@github.com:pinnerwt/query_tw.git cuizhao-dev'
```

If SSH-from-server-to-GitHub isn't already set up, use HTTPS:
```sh
ssh api_server 'cd /home/ubuntu && git clone https://github.com/pinnerwt/query_tw.git cuizhao-dev'
```

**Step 2: Copy state.json + .env from prod checkout**

```sh
ssh api_server 'cp /home/ubuntu/cuizhao/state.json /home/ubuntu/cuizhao-dev/state.json && cp /home/ubuntu/cuizhao/.env /home/ubuntu/cuizhao-dev/.env'
```

(Yes, the deploy script also rsyncs these — but cloning gives us a starting point.)

**Step 3: Verify**

```sh
ssh api_server 'ls /home/ubuntu/cuizhao-dev/{state.json,.env,deploy/docker-compose.yml}'
```
Expected: all three paths echoed.

No commit.

---

### Task 6: Generate deploy SSH key and install

**Step 1: Generate the keypair locally** (do NOT commit either half)

```sh
ssh-keygen -t ed25519 -f /tmp/cuizhao-deploy-key -N '' -C 'github-actions-cuizhao-deploy'
```

Two files appear: `/tmp/cuizhao-deploy-key` (private), `/tmp/cuizhao-deploy-key.pub`.

**Step 2: Install the public key on api_server**

```sh
cat /tmp/cuizhao-deploy-key.pub | ssh api_server 'cat >> ~/.ssh/authorized_keys'
```

**Step 3: Verify the new key works**

```sh
ssh -i /tmp/cuizhao-deploy-key -o IdentitiesOnly=yes ubuntu@query.tw 'echo ok'
```
Expected: `ok`.

**Step 4: Capture the host key**

```sh
ssh-keyscan -t ed25519,rsa,ecdsa query.tw > /tmp/cuizhao-known-hosts
cat /tmp/cuizhao-known-hosts
```
Expected: 2-3 lines, each starting with `query.tw`.

**Step 5: Add GitHub secrets**

```sh
gh secret set DEPLOY_SSH_KEY < /tmp/cuizhao-deploy-key
gh secret set DEPLOY_KNOWN_HOSTS < /tmp/cuizhao-known-hosts
```

**Step 6: Verify secrets exist**

```sh
gh secret list
```
Expected: lines for `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`.

**Step 7: Wipe local copies of the private key**

```sh
shred -u /tmp/cuizhao-deploy-key /tmp/cuizhao-deploy-key.pub /tmp/cuizhao-known-hosts
```

No commit.

---

## Phase 3 — Compose + nginx config for dev

### Task 7: Write `deploy/docker-compose.dev.yml`

**Files:**
- Create: `deploy/docker-compose.dev.yml`

**Step 1: Write the file**

```yaml
name: cuizhao-dev
services:
  api:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.api
    environment:
      DATABASE_URL: postgres://cuizhao:cuizhao@cuizhao-postgres-1:5432/cuizhao_dev?sslmode=disable
      REDIS_URL: redis://cuizhao-redis-1:6379/1
      RUN_MIGRATIONS: "1"
      STATIC_DIR: /app/dist
      PORT: "8080"
      ADMIN_BASIC_AUTH: ${ADMIN_BASIC_AUTH:-admin:changeme}
    networks:
      shared:
        aliases: [cuizhao-api-dev]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/healthz || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 6

  extractor:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.extractor
    environment:
      DATABASE_URL: postgres://cuizhao:cuizhao@cuizhao-postgres-1:5432/cuizhao_dev?sslmode=disable
      REDIS_URL: redis://cuizhao-redis-1:6379/1
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
    networks:
      shared: {}
    restart: unless-stopped

  scraper:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.scraper
    environment:
      REDIS_URL: redis://cuizhao-redis-1:6379/1
      QUERIES: ${SCRAPE_QUERIES_DEV:-徵才}
      MIN_POSTED_AT: ${MIN_POSTED_AT:-}
      MAX_SCROLLS: ${MAX_SCROLLS_DEV:-3}
      MAX_CONSEC_KNOWN: ${MAX_CONSEC_KNOWN_DEV:-3}
      MAX_WALL_MINUTES: ${MAX_WALL_MINUTES_DEV:-5}
      STORAGE_STATE: /app/state.json
    volumes:
      - ../state.json:/app/state.json:ro
    networks:
      shared: {}
    profiles: ["manual"]   # not started by `up -d`; run via `compose run --rm scraper`

networks:
  shared:
    name: deploy_default
    external: true
```

**Note:** The dev compose intentionally does **not** declare `postgres` or `redis` — they're attached via the external `deploy_default` network using their prod container hostnames (`cuizhao-postgres-1`, `cuizhao-redis-1`). Confirm those hostnames match the actual prod container names before deploying:

```sh
ssh api_server 'sudo docker ps --format "{{.Names}}"' | grep -E 'postgres|redis'
```

If the names differ, update the `DATABASE_URL` / `REDIS_URL` hosts in this file accordingly.

**Step 2: Validate YAML**

```sh
python3 -c 'import yaml; yaml.safe_load(open("deploy/docker-compose.dev.yml"))'
docker compose -f deploy/docker-compose.dev.yml config >/dev/null
```
Expected: no errors.

**Step 3: Commit**

```sh
git add deploy/docker-compose.dev.yml
git commit -m "Add docker-compose.dev.yml for dev environment"
```

---

### Task 8: Write `deploy/nginx-dev-query-tw.conf`

**Files:**
- Create: `deploy/nginx-dev-query-tw.conf`

**Step 1: Read the existing prod block**

```sh
cat deploy/nginx-query-tw.conf
```

**Step 2: Create the dev variant**

Mirror the prod file. Replace:
- `# CUIZHAO-NGINX-BLOCK-START/END` → `# CUIZHAO-DEV-NGINX-BLOCK-START/END`
- `server_name query.tw;` → `server_name dev.query.tw;`
- `proxy_pass http://cuizhao-api:8080;` → `proxy_pass http://cuizhao-api-dev:8080;`

Leave SSL config / Cloudflare settings identical (we share the cert via Cloudflare edge).

**Step 3: Verify markers and content**

```sh
grep -E '^# CUIZHAO-DEV-NGINX-BLOCK-(START|END)' deploy/nginx-dev-query-tw.conf
grep 'server_name dev.query.tw' deploy/nginx-dev-query-tw.conf
grep 'proxy_pass http://cuizhao-api-dev:8080' deploy/nginx-dev-query-tw.conf
```
Expected: each grep prints exactly 1 (or 2 for the first) match.

**Step 4: Commit**

```sh
git add deploy/nginx-dev-query-tw.conf
git commit -m "Add nginx vhost for dev.query.tw"
```

---

### Task 9: Refactor `deploy/deploy-monitor.sh` for `[prod|dev]` arg

**Files:**
- Modify: `deploy/deploy-monitor.sh`

**Step 1: Sketch the new dispatch**

Top of the script, after `set -euo pipefail`:

```sh
ENV="${1:-prod}"
EXTRA="${2:-}"
case "$ENV" in
  prod|dev) ;;
  scrape)   ENV="prod"; EXTRA="scrape" ;;       # legacy: ./deploy-monitor.sh scrape
  *)        echo "usage: $0 [prod|dev] [scrape|--reseed]" >&2; exit 2 ;;
esac

if [[ "$ENV" == "prod" ]]; then
  DEST_DEFAULT="/home/ubuntu/cuizhao"
  COMPOSE_FILE="deploy/docker-compose.yml"
  PROJECT="cuizhao"
  NGINX_SNIPPET_PATH="deploy/nginx-query-tw.conf"
  NGINX_BLOCK_START="# CUIZHAO-NGINX-BLOCK-START"
  NGINX_BLOCK_END="# CUIZHAO-NGINX-BLOCK-END"
  HEALTHZ_HOST="query.tw"
  INSTALL_CRON="1"
else
  DEST_DEFAULT="/home/ubuntu/cuizhao-dev"
  COMPOSE_FILE="deploy/docker-compose.dev.yml"
  PROJECT="cuizhao-dev"
  NGINX_SNIPPET_PATH="deploy/nginx-dev-query-tw.conf"
  NGINX_BLOCK_START="# CUIZHAO-DEV-NGINX-BLOCK-START"
  NGINX_BLOCK_END="# CUIZHAO-DEV-NGINX-BLOCK-END"
  HEALTHZ_HOST="dev.query.tw"
  INSTALL_CRON="0"
fi

DEST="${DEPLOY_DEST:-$DEST_DEFAULT}"
COMPOSE="sudo docker compose -f ${COMPOSE_FILE} --env-file .env"
RUN_SCRAPER=""
RESEED=""
case "$EXTRA" in
  scrape)   RUN_SCRAPER="1" ;;
  --reseed) RESEED="1" ;;
  "")       ;;
  *)        echo "unknown extra: $EXTRA" >&2; exit 2 ;;
esac
```

**Step 2: Update the script body to use the variables**

Replace the hardcoded references:
- `cd ${DEST}` (already parametric)
- `${COMPOSE} build api extractor` and `${COMPOSE} up -d postgres redis api extractor` — for dev, `postgres redis` are external, so:
  ```sh
  if [[ "$ENV" == "prod" ]]; then
    SVCS="postgres redis api extractor"
  else
    SVCS="api extractor"
  fi
  ssh "${HOST}" "cd ${DEST} && ${COMPOSE} build api extractor && ${COMPOSE} up -d ${SVCS}"
  ```
- `SNIPPET="${DEST}/deploy/nginx-query-tw.conf"` → `SNIPPET="${DEST}/${NGINX_SNIPPET_PATH}"`
- The `sed -i` markers and the `awk` insertion point — use `${NGINX_BLOCK_START}` / `${NGINX_BLOCK_END}` shell-expanded into the heredoc. Be careful: the heredoc is currently quoted/expanded with the inner `\${var}` escaping for ssh-side vs local. Variables that should expand on the *local* side (the env-specific names) need to be **un-escaped**: `${NGINX_BLOCK_START}` not `\${NGINX_BLOCK_START}`. Variables that should expand on the *server* side (`\${NGINX_CONF}`, `\${SNIPPET}`) keep their backslash.

  Concretely, replace the `sed -i '/# CUIZHAO-NGINX-BLOCK-START/,/# CUIZHAO-NGINX-BLOCK-END/d' "\${NGINX_CONF}"` line with:
  ```sh
  sed -i "/${NGINX_BLOCK_START}/,/${NGINX_BLOCK_END}/d" "\${NGINX_CONF}"
  ```
  And the `awk` insertion-point comment (`/# Default — reject unknown hosts/`) stays the same — both prod and dev blocks insert at the same anchor.

- Cron install: gate the existing line:
  ```sh
  if [[ "$INSTALL_CRON" == "1" ]]; then
    ssh "${HOST}" "sudo install -o root -g root -m 0644 ${DEST}/deploy/cuizhao-scrape.cron /etc/cron.d/cuizhao-scrape"
  fi
  ```

- Healthz probe: `--resolve "${HEALTHZ_HOST}:443:${HOST_IP}" https://${HEALTHZ_HOST}/healthz`.

**Step 3: Update header comment**

Replace the top usage comment with:
```sh
# Usage:
#   ./deploy/deploy-monitor.sh                     # prod (default)
#   ./deploy/deploy-monitor.sh prod                # explicit prod
#   ./deploy/deploy-monitor.sh prod scrape         # prod + one scraper pass
#   ./deploy/deploy-monitor.sh dev                 # dev environment
#   ./deploy/deploy-monitor.sh dev --reseed        # rebuild dev DB from prod snapshot
#   ./deploy/deploy-monitor.sh scrape              # legacy alias for "prod scrape"
```

**Step 4: Verify shell syntax**

```sh
bash -n deploy/deploy-monitor.sh
```
Expected: silent, exit 0.

**Step 5: Dry-run trace (do NOT actually deploy)**

```sh
DEPLOY_HOST=__nohost__ bash -x deploy/deploy-monitor.sh prod 2>&1 | head -20
```

You'll see it fail at the first ssh — that's fine. The point is to confirm the dispatch picks `prod` values (`/home/ubuntu/cuizhao`, `cuizhao-api`, `query.tw`).

```sh
DEPLOY_HOST=__nohost__ bash -x deploy/deploy-monitor.sh dev 2>&1 | head -20
```
Expected: see `cuizhao-dev`, `dev.query.tw`, `cuizhao-api-dev` in trace.

**Step 6: Commit**

```sh
git add deploy/deploy-monitor.sh
git commit -m "deploy-monitor.sh: support [prod|dev] env arg"
```

---

### Task 10: Add `--reseed` subcommand

**Files:**
- Modify: `deploy/deploy-monitor.sh`

**Step 1: Append the reseed branch to the script**

After the dispatch parsing, before any rsync, add:

```sh
if [[ "$RESEED" == "1" ]]; then
  if [[ "$ENV" != "dev" ]]; then echo "--reseed is dev-only" >&2; exit 2; fi
  echo "==> snapshotting prod cuizhao -> cuizhao_dev (last 14 days of posts)"
  ssh "${HOST}" "sudo bash -se" <<'EOF'
set -euo pipefail
PG=cuizhao-postgres-1
TABLES="posts jobs skills roles job_skills job_experience job_languages job_tags"
DAYS=14
docker exec -i $PG psql -U cuizhao -d cuizhao_dev -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE $(echo $TABLES | sed 's/ /, /g') RESTART IDENTITY CASCADE;"
docker exec -i $PG bash -c "
  set -euo pipefail
  pg_dump -U cuizhao -d cuizhao --data-only --no-owner \
    --table=skills --table=roles \
    | psql -U cuizhao -d cuizhao_dev -v ON_ERROR_STOP=1
  PIDS=\$(psql -U cuizhao -d cuizhao -tAc \"SELECT id FROM posts WHERE posted_at > now() - interval '${DAYS} days'\" | tr '\n' ',' | sed 's/,$//')
  if [ -z \"\$PIDS\" ]; then echo 'no recent posts'; exit 0; fi
  pg_dump -U cuizhao -d cuizhao --data-only --no-owner \
    --table=posts --table=jobs --table=job_skills \
    --table=job_experience --table=job_languages --table=job_tags \
    | psql -U cuizhao -d cuizhao_dev -v ON_ERROR_STOP=1
"
echo "reseed: done"
EOF
  exit 0
fi
```

(Note: this does a full `pg_dump` of jobs/posts and lets `cuizhao_dev` reject rows that don't reference our subset via the `--where` filter. Simpler v1: dump all of jobs/posts; if the dataset gets large, refine later.)

**Step 2: Verify shell syntax**

```sh
bash -n deploy/deploy-monitor.sh
```

**Step 3: Commit**

```sh
git add deploy/deploy-monitor.sh
git commit -m "deploy-monitor.sh: add --reseed for dev DB from prod snapshot"
```

---

## Phase 4 — DNS, dev branch, and first dev deploy

### Task 11: Add Cloudflare DNS for `dev.query.tw`

**This is a manual step in the Cloudflare dashboard.** Cannot be scripted from this environment.

**Step 1:** Cloudflare → DNS → Add record.
- Type: `A` (or CNAME to `query.tw`)
- Name: `dev`
- Target: same IP as the existing `query.tw` A record
- Proxy: Proxied (orange cloud)

**Step 2: Verify**

```sh
dig +short dev.query.tw
```
Expected: a Cloudflare-edge IP (104.x or 172.x range).

**Step 3: Verify edge cert covers dev**

```sh
echo | openssl s_client -connect dev.query.tw:443 -servername dev.query.tw 2>/dev/null | openssl x509 -noout -text | grep -E 'DNS:'
```
Expected: SAN list includes both `query.tw` and `dev.query.tw` (Cloudflare's universal SSL handles this automatically once the record exists).

No commit.

---

### Task 12: Create the `dev` branch and first manual deploy

**Step 1: Create branch from master**

```sh
git checkout master
git pull
git checkout -b dev
git push -u origin dev
```

**Step 2: First manual deploy from your laptop**

```sh
./deploy/deploy-monitor.sh dev 2>&1 | tee /tmp/dev-deploy.log
```

Watch for:
- web bundle build succeeds
- rsync to `/home/ubuntu/cuizhao-dev/`
- compose builds + brings up `api`, `extractor` (no `postgres`, no `redis`)
- nginx vhost installed
- healthz probe passes

If healthz fails, check:
```sh
ssh api_server 'sudo docker logs --tail 50 cuizhao-dev-api-1'
ssh api_server 'sudo docker exec deploy-nginx-1 nginx -t'
```

**Step 3: Verify the dev API is reachable**

```sh
curl -fsS https://dev.query.tw/healthz
```
Expected: `ok` (or whatever prod healthz returns).

**Step 4: Verify dev container is on the right network alias**

```sh
ssh api_server 'sudo docker inspect cuizhao-dev-api-1 -f "{{json .NetworkSettings.Networks}}"' | python3 -m json.tool | grep -A2 deploy_default
```
Expected: contains `cuizhao-api-dev` in `Aliases`.

**Step 5: Verify migrations created tables in `cuizhao_dev`**

```sh
ssh api_server 'sudo docker exec -i cuizhao-postgres-1 psql -U cuizhao -d cuizhao_dev -c "\dt"'
```
Expected: 9 tables.

No commit (dev branch already pushed in Step 1).

---

### Task 13: Reseed dev from prod and verify UI shows data

**Step 1: Run reseed**

```sh
./deploy/deploy-monitor.sh dev --reseed
```
Expected: `reseed: done`.

**Step 2: Verify row counts**

```sh
ssh api_server 'sudo docker exec -i cuizhao-postgres-1 psql -U cuizhao -d cuizhao_dev -c "SELECT count(*) FROM posts; SELECT count(*) FROM jobs;"'
```
Expected: non-zero counts in both.

**Step 3: Smoke test the UI**

```sh
curl -fsS https://dev.query.tw/api/jobs?limit=3 | head -50
```
Expected: JSON with at least one job.

Open `https://dev.query.tw` in a browser and confirm the home page renders with data.

No commit.

---

## Phase 5 — Auto-deploy from GH Actions

### Task 14: Write `.github/workflows/deploy.yml`

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Write the workflow**

```yaml
name: deploy

on:
  push:
    branches: [master, dev]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.DEPLOY_SSH_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          echo "${{ secrets.DEPLOY_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
          chmod 644 ~/.ssh/known_hosts

      - name: Pick environment
        id: env
        run: |
          case "${GITHUB_REF##*/}" in
            master) echo "env=prod" >> "$GITHUB_OUTPUT"; echo "dest=/home/ubuntu/cuizhao" >> "$GITHUB_OUTPUT" ;;
            dev)    echo "env=dev"  >> "$GITHUB_OUTPUT"; echo "dest=/home/ubuntu/cuizhao-dev" >> "$GITHUB_OUTPUT" ;;
            *)      echo "unexpected ref ${GITHUB_REF}"; exit 1 ;;
          esac

      - name: Deploy
        run: |
          SHA=${{ github.sha }}
          ENV=${{ steps.env.outputs.env }}
          DEST=${{ steps.env.outputs.dest }}
          ssh -i ~/.ssh/id_ed25519 ubuntu@query.tw bash -se <<EOF
            set -euo pipefail
            cd "${DEST}"
            git fetch origin
            git checkout "${SHA}"
            ./deploy/deploy-monitor.sh "${ENV}"
          EOF
```

**Note on `deploy-monitor.sh` from the server:** the existing script SSHes from a controller into `api_server`. When invoked from `api_server` *itself* (i.e. ssh-from-localhost-to-self), the `ssh "${HOST}"` calls will fail unless we either:

(a) Have GH Actions run the deploy on a controller that SSHes in (current design — the GH Actions runner *is* that controller).

The workflow above uses (a): the GH runner SSHes into `api_server` and runs `./deploy/deploy-monitor.sh`, which itself does another ssh to `${DEPLOY_HOST:-api_server}`. Since the controller-to-host hop is already happening at GH runner level, `deploy-monitor.sh` running on `api_server` would re-ssh to itself — works if the ubuntu user has its own pubkey in `authorized_keys`, but inefficient.

**Better approach:** run `deploy-monitor.sh` directly from the GH runner (no ssh-into-server), since that's exactly what the script was written to do. Replace the `Deploy` step with:

```yaml
      - name: Deploy
        env:
          DEPLOY_HOST: ubuntu@query.tw
        run: |
          SHA=${{ github.sha }}
          ENV=${{ steps.env.outputs.env }}
          # Pull the latest code locally on the runner; deploy-monitor.sh
          # rsyncs from the runner's working tree to the host.
          git fetch --depth=1 origin "${SHA}"
          git checkout "${SHA}"
          # web/ is built locally inside deploy-monitor.sh, so we need npm.
          # setup-node is added below.
          ./deploy/deploy-monitor.sh "${ENV}"
```

Then add a `setup-node` step before deploy:
```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
        working-directory: web
```

**Final workflow** combines the above. Validate locally:

```sh
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/deploy.yml"))'
```

**Step 2: Commit on a branch (not dev/master)**

```sh
git checkout -b cd-bringup
git add .github/workflows/deploy.yml
git commit -m "Add deploy workflow for master->prod and dev->dev"
```

---

### Task 15: Test deploy via dev branch first

**Step 1: Merge cd-bringup to dev (low risk — dev is already running, redeploy is a no-op)**

```sh
git checkout dev
git merge cd-bringup
git push origin dev
```

**Step 2: Watch the workflow**

```sh
gh run watch
```

Expected: `ci` jobs pass (filtered), `deploy` job runs and deploys to dev. Total ~3-5 minutes.

**Step 3: Verify dev is still healthy**

```sh
curl -fsS https://dev.query.tw/healthz
```

If anything breaks, check the GH Actions log — most likely cause is a missing secret, wrong `DEPLOY_HOST`, or `deploy-monitor.sh` ssh'ing to the wrong host. Fix on `cd-bringup`, push to dev, retry.

**Step 4: Promote to master via PR**

Once dev deploy is solid:
```sh
git checkout master
git pull
gh pr create --base master --head dev --title 'CI/CD bringup' --body 'Wires CI and auto-deploy to prod'
```

Review the PR diff, merge it. Watch:
```sh
gh run watch
```
Expected: `deploy` job deploys master → prod. Verify:
```sh
curl -fsS https://query.tw/healthz
```

---

## Phase 6 — Documentation

### Task 16: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add a new section after "Cardinal rule"**

```markdown
## Branches and environments

- `master` deploys to `query.tw` (prod) automatically on push.
- `dev` deploys to `dev.query.tw` (dev) automatically on push. Same `api_server`,
  isolated `cuizhao_dev` Postgres database and redis db `1`.
- Feature branches: CI only. Open PR to `dev` to preview, then `dev` → `master`
  for prod.

## Working on dev

- Manual deploy: `./deploy/deploy-monitor.sh dev`
- Reseed dev DB from prod snapshot: `./deploy/deploy-monitor.sh dev --reseed`
  (manual only — normal deploys preserve dev data)
- Dev scraper does not run on cron. To run one pass:
  `ssh api_server 'cd /home/ubuntu/cuizhao-dev && sudo docker compose -f deploy/docker-compose.dev.yml --env-file .env --profile manual run --rm scraper'`
```

**Step 2: Commit**

```sh
git checkout -b docs-cicd
git add CLAUDE.md
git commit -m "Document CI/CD branches and dev environment workflow"
git push -u origin docs-cicd
gh pr create --base dev --fill
```

Merge to `dev` → `master` per your usual flow.

---

## Verification checklist

After all tasks complete, verify end-to-end:

- [ ] `gh run list --limit 5` shows recent green CI on at least one PR and one master push
- [ ] `curl -fsS https://query.tw/healthz` → `ok`
- [ ] `curl -fsS https://dev.query.tw/healthz` → `ok`
- [ ] `gh secret list` shows `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`
- [ ] `ssh api_server 'sudo docker ps --format "{{.Names}}\t{{.Status}}"' | grep cuizhao-dev` shows healthy `api` and `extractor`
- [ ] `ssh api_server 'sudo docker exec -i cuizhao-postgres-1 psql -U cuizhao -d cuizhao_dev -c "SELECT count(*) FROM posts"'` → non-zero after reseed
- [ ] Pushing to `dev` auto-deploys, master is unaffected
- [ ] Pushing to `master` auto-deploys, dev is unaffected
- [ ] `dev.query.tw` shows the same UI as `query.tw` (different data is OK and expected)

---

## Rollback notes

- **CI breaks on green PR:** revert `.github/workflows/ci.yml` to remove failing job, push.
- **Deploy workflow misfires:** `gh secret delete DEPLOY_SSH_KEY` immediately disables auto-deploy.
- **Dev DB corrupted:** `./deploy/deploy-monitor.sh dev --reseed` rebuilds it.
- **Dev nginx block breaks prod nginx:** `ssh api_server 'sudo sed -i "/# CUIZHAO-DEV-NGINX-BLOCK-START/,/# CUIZHAO-DEV-NGINX-BLOCK-END/d" /home/ubuntu/tiayn-v2/deploy/nginx.conf && sudo docker exec deploy-nginx-1 nginx -s reload'` removes the dev block.
