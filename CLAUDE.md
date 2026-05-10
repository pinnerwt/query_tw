# Working on this repo

This file documents the local-and-remote workflow for 脆找工作 (cuizhao).
The remote target is `ssh api_server` (DNS: query.tw, IP 91.98.207.105),
where a shared nginx (`deploy-nginx-1`) terminates TLS for several apps and
proxies query.tw to our `api` container via the `deploy_default` docker
network alias `cuizhao-api`.

## Cardinal rule

`./deploy/deploy-monitor.sh` is the only sanctioned path from a local change
to a deployed change. It does, in order:

1. `npm run build` in `web/` (locally — much faster than building inside docker).
2. `rsync` the repo (including the freshly-built `web/dist/` and `state.json`)
   to `api_server:/home/ubuntu/cuizhao/`.
3. `docker compose build api extractor` and `up -d` on the host.
4. Install/refresh the query.tw nginx server-block via `deploy/nginx-query-tw.conf`
   (in-place rewrite — keeps the inode so the bind-mount stays valid) and reload
   nginx.
5. Install `/etc/cron.d/cuizhao-scrape` from `deploy/cuizhao-scrape.cron`.
6. Probe `https://query.tw/healthz` directly via the host IP (bypass Cloudflare
   cache) until 200.
7. If invoked as `./deploy/deploy-monitor.sh scrape`, also build the scraper
   image and run one one-shot pass.

## Branches and environments

- `master` deploys to `query.tw` (prod) automatically on push.
- `dev` deploys to `dev.query.tw` (dev) automatically on push. Same `api_server`,
  isolated `cuizhao_dev` Postgres database and redis db `1`. Dev shares the
  prod containers' `cuizhao_default` network for postgres/redis access.
- Feature branches: CI only. Open PR to `dev` to preview, then `dev` → `master`
  for prod.
- The `deploy` workflow ssh-targets `91.98.207.105` directly because `query.tw`
  is Cloudflare-proxied and SSH does not pass through the edge. Secrets:
  `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (set via `gh secret set`).

## Working on dev

- Manual deploy: `./deploy/deploy-monitor.sh dev`
- Reseed dev DB from prod snapshot: `./deploy/deploy-monitor.sh dev --reseed`
  (manual only — normal deploys preserve dev data)
- Dev scraper does not run on cron. To run one pass:
  `ssh api_server 'cd /home/ubuntu/cuizhao-dev && sudo docker compose -f deploy/docker-compose.dev.yml --env-file .env --profile manual run --rm scraper'`

## Common change shapes — what to do

### Frontend-only change (`web/src/...`)

`web/dist` is `COPY`'d into the api image at build time — rsyncing dist alone
does **not** update what users see. You must rebuild and recreate the api
container:

```sh
( cd web && npm run build ) \
  && rsync -az web/dist/ api_server:/home/ubuntu/cuizhao/web/dist/ \
  && ssh api_server 'cd /home/ubuntu/cuizhao && sudo docker compose -f deploy/docker-compose.yml --env-file .env build api && sudo docker compose -f deploy/docker-compose.yml --env-file .env up -d api'
```

Or just run `./deploy/deploy-monitor.sh` which does the same plus everything else.

### Go change (`cmd/`, `internal/`)

Same as above — `deploy-monitor.sh` rebuilds the api / extractor image, recreates
the container, runs healthz.

### Env-var change (e.g. `SCRAPE_QUERIES`, `ADMIN_BASIC_AUTH`, `DEEPSEEK_API_KEY`)

`.env` is gitignored and lives at the repo root locally; `deploy-monitor.sh`
rsyncs it to the host. Compose reads it via `--env-file .env` at every
`up`/`run`. Workflow:

```sh
# edit /home/pgi/matching/.env
rsync -az /home/pgi/matching/.env api_server:/home/ubuntu/cuizhao/.env
ssh api_server 'cd /home/ubuntu/cuizhao && sudo docker compose -f deploy/docker-compose.yml --env-file .env up -d api'
```

For scraper-only env vars (`SCRAPE_QUERIES`, `MAX_*`), no restart is needed —
each `compose run --rm scraper` invocation (cron or manual) re-reads `.env`.

### `state.json` (Threads auth cookies)

Lives at the repo root, gitignored. Rsynced to the host by `deploy-monitor.sh`.
The scraper container mounts it read-only at `/app/state.json` and reads via
`STORAGE_STATE` (set in `deploy/docker-compose.yml`). To refresh:

```sh
# regenerate state.json locally with playwright codegen (logged-in browser),
# then:
./deploy/deploy-monitor.sh scrape   # rsyncs + runs one auth-enabled pass
```

### Cron schedule (`deploy/cuizhao-scrape.cron`)

Edit the file in the repo, then run `./deploy/deploy-monitor.sh` — it
`sudo install`s the file to `/etc/cron.d/cuizhao-scrape` so the source of
truth is the repo, not the server.

### nginx vhost (`deploy/nginx-query-tw.conf`)

Edit the file in the repo, then `./deploy/deploy-monitor.sh`. The script
finds the `# CUIZHAO-NGINX-BLOCK-{START,END}` markers in the host's
`nginx.conf`, replaces between them with the snippet, and reloads nginx.
**Do not** `mv` the new config over the old one — the bind-mount caches by
inode; the script uses `cat > FILE` for that reason.

## Known gotchas

- **Buffered output**: never wrap `deploy-monitor.sh` output in `| tail -N`
  in a no-tty context. Output is line-buffered and `tail` only emits at EOF;
  if the script hangs you'll see no progress. Use `tee /tmp/deploy.log`
  instead.
- **`web/dist` lives in two places**: the `dist/` you ship and `dist/` baked
  into the api image. After rsync, you must rebuild the api image — see
  Frontend-only above.
- **ubuntu is in the docker group** on api_server, so cron uses `docker
  compose` without sudo. The deploy script still uses `sudo docker compose`
  (works either way).
- **Cloudflare proxy** sits in front of query.tw (orange cloud, SSL=Full).
  Always probe healthz with `--resolve query.tw:443:<host_ip>` to bypass any
  cached edge response.
- **Admin endpoints live at `/admin/api/...`**, not `/admin/...`. The latter
  hits the SPA fallback and returns 200 (index.html). When verifying basic
  auth, hit `/admin/api/whoami`.
