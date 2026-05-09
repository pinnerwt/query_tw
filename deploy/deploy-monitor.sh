#!/usr/bin/env bash
# Deploy 脆找工作 to the api_server host (query.tw).
#
# Usage:
#   ./deploy/deploy-monitor.sh          # rsync, build, up, install nginx vhost
#   ./deploy/deploy-monitor.sh scrape   # also run one scraper pass
#
# Requires: ssh access to ${DEPLOY_HOST:-api_server} with sudo for docker.
# A local .env at the repo root with DEEPSEEK_API_KEY is rsynced to the host.
#
# How routing works on this host: a shared nginx (deploy-nginx-1) on the
# external `deploy_default` docker network terminates 80/443 for several
# unrelated apps. We attach our `api` service to that network with alias
# `cuizhao-api`, then drop a query.tw server-block into the live nginx
# config and reload nginx.
set -euo pipefail

HOST="${DEPLOY_HOST:-api_server}"
DEST="${DEPLOY_DEST:-/home/ubuntu/cuizhao}"
NGINX_CONF="${NGINX_CONF:-/home/ubuntu/tiayn-v2/deploy/nginx.conf}"
NGINX_CONTAINER="${NGINX_CONTAINER:-deploy-nginx-1}"
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

echo "==> installing query.tw nginx vhost"
# The block in deploy/nginx-query-tw.conf is delimited by
# CUIZHAO-NGINX-BLOCK-{START,END}; install or replace it idempotently
# inside the existing nginx.conf, then reload nginx.
ssh "${HOST}" "sudo bash -se" <<EOF
set -euo pipefail
NGINX_CONF="${NGINX_CONF}"
SNIPPET="${DEST}/deploy/nginx-query-tw.conf"
cp --update=none "\${NGINX_CONF}" "\${NGINX_CONF}.bak.\$(date +%s)" || true
sed -i '/# CUIZHAO-NGINX-BLOCK-START/,/# CUIZHAO-NGINX-BLOCK-END/d' "\${NGINX_CONF}"
# Insert our block right before the existing default-server block.
TMP="\${NGINX_CONF}.new"
awk -v sf="\${SNIPPET}" '
  /# Default — reject unknown hosts/ && !done {
    while ((getline line < sf) > 0) print "    " line
    close(sf)
    done=1
  }
  { print }
' "\${NGINX_CONF}" > "\${TMP}"
# In-place rewrite (cp not mv) so we keep the same inode — docker
# bind-mounts the file by inode, and a mv would leave the container
# pointing at the old (now-orphaned) inode.
cat "\${TMP}" > "\${NGINX_CONF}"
rm -f "\${TMP}"
docker exec ${NGINX_CONTAINER} nginx -t
docker exec ${NGINX_CONTAINER} nginx -s reload
EOF

echo "==> installing scraper cron"
ssh "${HOST}" "sudo install -o root -g root -m 0644 ${DEST}/deploy/cuizhao-scrape.cron /etc/cron.d/cuizhao-scrape"

echo "==> waiting for healthz via nginx"
# Resolve query.tw directly to the host so we test the new origin, not
# the (possibly stale) Cloudflare-edge IP.
HOST_IP=$(ssh -G "${HOST}" | awk '/^hostname /{print $2}')
echo "    direct probe via ${HOST_IP}"
healthy=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -skf -m 5 --resolve "query.tw:443:${HOST_IP}" https://query.tw/healthz >/dev/null; then
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
