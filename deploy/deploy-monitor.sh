#!/usr/bin/env bash
# Deploy 脆找工作 to the monitor host (query.tw).
#
# Usage:  ./deploy/deploy-monitor.sh
# Requires: ssh access to the monitor host (`ssh monitor`) with sudo for docker.
#
# The api container joins the host's existing `traefik-web` network and is
# routed by Traefik labels for Host(`query.tw`).
set -euo pipefail

HOST="${DEPLOY_HOST:-monitor}"
DEST="${DEPLOY_DEST:-/home/ubuntu/cuizhao}"
COMPOSE="sudo docker compose -f deploy/docker-compose.yml"

echo "==> rsyncing repo to ${HOST}:${DEST}"
ssh "${HOST}" "mkdir -p ${DEST}"
rsync -azP \
  --exclude '.git' --exclude 'node_modules' --exclude 'web/dist' --exclude 'dist' \
  --exclude 'bin' --exclude '.env' \
  ./ "${HOST}:${DEST}/"

echo "==> building and starting compose on ${HOST}"
ssh "${HOST}" "cd ${DEST} && ${COMPOSE} build && ${COMPOSE} up -d"

echo "==> seeding fixtures"
ssh "${HOST}" "cd ${DEST} && ${COMPOSE} run --rm seeder || true"

echo "==> waiting for healthz via Traefik"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -skf https://query.tw/healthz >/dev/null; then echo "healthy"; exit 0; fi
  sleep 3
done
echo "NOT HEALTHY" >&2
exit 1
