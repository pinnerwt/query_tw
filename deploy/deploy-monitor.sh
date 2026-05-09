#!/usr/bin/env bash
# Deploy 脆找工作 to the monitor host (query.tw).
#
# Usage:
#   ./deploy/deploy-monitor.sh          # rsync, build, up
#   ./deploy/deploy-monitor.sh scrape   # also run one scraper pass
#
# Requires: ssh access to the monitor host (`ssh monitor`) with sudo for docker.
# A local .env at the repo root with DEEPSEEK_API_KEY is rsynced to the host.
set -euo pipefail

HOST="${DEPLOY_HOST:-monitor}"
DEST="${DEPLOY_DEST:-/home/ubuntu/cuizhao}"
COMPOSE="sudo docker compose -f deploy/docker-compose.yml --env-file .env"
RUN_SCRAPER="${1:-}"

echo "==> building web bundle locally"
( cd web && npm run build )

echo "==> rsyncing repo to ${HOST}:${DEST}"
ssh "${HOST}" "mkdir -p ${DEST}"
rsync -azP \
  --exclude '.git' --exclude 'node_modules' --exclude 'bin' \
  --include '.env' \
  ./ "${HOST}:${DEST}/"

echo "==> building and starting compose on ${HOST}"
ssh "${HOST}" "cd ${DEST} && ${COMPOSE} build api extractor && ${COMPOSE} up -d postgres redis api extractor"

echo "==> waiting for healthz via Traefik"
healthy=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -skf https://query.tw/healthz >/dev/null; then
    echo "healthy"
    healthy=1
    break
  fi
  sleep 3
done
if [[ "${healthy}" != "1" ]]; then
  echo "NOT HEALTHY" >&2
  exit 1
fi

if [[ "${RUN_SCRAPER}" == "scrape" ]]; then
  echo "==> running one-shot scraper"
  ssh "${HOST}" "cd ${DEST} && ${COMPOSE} build scraper && ${COMPOSE} run --rm scraper"
fi

echo "Done."
