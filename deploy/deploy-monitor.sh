#!/usr/bin/env bash
# Deploy 脆找工作 to the api_server host.
#
# Usage:
#   ./deploy/deploy-monitor.sh                     # prod (default)
#   ./deploy/deploy-monitor.sh prod                # explicit prod
#   ./deploy/deploy-monitor.sh prod scrape         # prod + one scraper pass
#   ./deploy/deploy-monitor.sh dev                 # dev environment
#   ./deploy/deploy-monitor.sh dev --reseed        # rebuild dev DB from prod snapshot
#   ./deploy/deploy-monitor.sh scrape              # legacy alias for "prod scrape"
#
# Requires: ssh access to ${DEPLOY_HOST:-api_server} with sudo for docker.
# A local .env at the repo root with DEEPSEEK_API_KEY is rsynced to the host.
#
# How routing works on this host: a shared nginx (deploy-nginx-1) on the
# external `deploy_default` docker network terminates 80/443 for several
# unrelated apps. We attach our `api` service to that network with a
# per-env alias (`cuizhao-api` for prod, `cuizhao-api-dev` for dev), then
# drop a vhost server-block into the live nginx config and reload nginx.
set -euo pipefail

ENV="${1:-prod}"
EXTRA="${2:-}"
case "$ENV" in
  prod|dev) ;;
  scrape)   ENV="prod"; EXTRA="scrape" ;;
  *)        echo "usage: $0 [prod|dev] [scrape|--reseed]" >&2; exit 2 ;;
esac

if [[ "$ENV" == "prod" ]]; then
  DEST_DEFAULT="/home/ubuntu/cuizhao"
  COMPOSE_FILE="deploy/docker-compose.yml"
  NGINX_SNIPPET_PATH="deploy/nginx-query-tw.conf"
  NGINX_BLOCK_START="# CUIZHAO-NGINX-BLOCK-START"
  NGINX_BLOCK_END="# CUIZHAO-NGINX-BLOCK-END"
  HEALTHZ_HOST="query.tw"
  INSTALL_CRON="1"
  SVCS="postgres redis api extractor"
else
  DEST_DEFAULT="/home/ubuntu/cuizhao-dev"
  COMPOSE_FILE="deploy/docker-compose.dev.yml"
  NGINX_SNIPPET_PATH="deploy/nginx-dev-query-tw.conf"
  NGINX_BLOCK_START="# CUIZHAO-DEV-NGINX-BLOCK-START"
  NGINX_BLOCK_END="# CUIZHAO-DEV-NGINX-BLOCK-END"
  HEALTHZ_HOST="dev.query.tw"
  INSTALL_CRON="0"
  SVCS="api extractor"
fi

RUN_SCRAPER=""
RESEED=""
case "$EXTRA" in
  scrape)   RUN_SCRAPER="1" ;;
  --reseed) RESEED="1" ;;
  "")       ;;
  *)        echo "unknown extra: $EXTRA" >&2; exit 2 ;;
esac

HOST="${DEPLOY_HOST:-api_server}"
DEST="${DEPLOY_DEST:-$DEST_DEFAULT}"
NGINX_CONF="${NGINX_CONF:-/home/ubuntu/tiayn-v2/deploy/nginx.conf}"
NGINX_CONTAINER="${NGINX_CONTAINER:-deploy-nginx-1}"
COMPOSE="sudo docker compose -f ${COMPOSE_FILE} --env-file .env"

if [[ "$RESEED" == "1" ]]; then
  if [[ "$ENV" != "dev" ]]; then echo "--reseed is dev-only" >&2; exit 2; fi
  echo "==> snapshotting prod cuizhao -> cuizhao_dev"
  ssh "${HOST}" "sudo bash -se" <<'EOF'
set -euo pipefail
PG=cuizhao-postgres-1
TABLES="posts jobs skills roles job_skills job_experience job_languages job_tags"
docker exec -i $PG psql -U cuizhao -d cuizhao_dev -v ON_ERROR_STOP=1 \
  -c "TRUNCATE TABLE $(echo $TABLES | sed 's/ /, /g') RESTART IDENTITY CASCADE;"
docker exec -i $PG bash -c "
  set -euo pipefail
  pg_dump -U cuizhao -d cuizhao --data-only --no-owner \
    --table=skills --table=roles \
    | psql -U cuizhao -d cuizhao_dev -v ON_ERROR_STOP=1
  pg_dump -U cuizhao -d cuizhao --data-only --no-owner \
    --table=posts --table=jobs --table=job_skills \
    --table=job_experience --table=job_languages --table=job_tags \
    | psql -U cuizhao -d cuizhao_dev -v ON_ERROR_STOP=1
"
echo "reseed: done"
EOF
  exit 0
fi

echo "==> building web bundle locally"
( cd web && npm run build )

echo "==> rsyncing repo to ${HOST}:${DEST}"
ssh "${HOST}" "mkdir -p ${DEST}"
rsync -azP \
  --exclude '.git' --exclude 'node_modules' --exclude 'bin' \
  --include '.env' \
  ./ "${HOST}:${DEST}/"

echo "==> building and starting compose on ${HOST} (${ENV})"
ssh "${HOST}" "cd ${DEST} && ${COMPOSE} build api extractor && ${COMPOSE} up -d ${SVCS}"

echo "==> installing ${HEALTHZ_HOST} nginx vhost"
ssh "${HOST}" "sudo bash -se" <<EOF
set -euo pipefail
NGINX_CONF="${NGINX_CONF}"
SNIPPET="${DEST}/${NGINX_SNIPPET_PATH}"
cp --update=none "\${NGINX_CONF}" "\${NGINX_CONF}.bak.\$(date +%s)" || true
sed -i "/${NGINX_BLOCK_START}/,/${NGINX_BLOCK_END}/d" "\${NGINX_CONF}"
TMP="\${NGINX_CONF}.new"
awk -v sf="\${SNIPPET}" '
  /# Default — reject unknown hosts/ && !done {
    while ((getline line < sf) > 0) print "    " line
    close(sf)
    done=1
  }
  { print }
' "\${NGINX_CONF}" > "\${TMP}"
cat "\${TMP}" > "\${NGINX_CONF}"
rm -f "\${TMP}"
docker exec ${NGINX_CONTAINER} nginx -t
docker exec ${NGINX_CONTAINER} nginx -s reload
EOF

if [[ "${INSTALL_CRON}" == "1" ]]; then
  echo "==> installing scraper cron"
  ssh "${HOST}" "sudo install -o root -g root -m 0644 ${DEST}/deploy/cuizhao-scrape.cron /etc/cron.d/cuizhao-scrape"
fi

echo "==> waiting for healthz via nginx (${HEALTHZ_HOST})"
HOST_IP=$(ssh -G "${HOST}" | awk '/^hostname /{print $2}')
echo "    direct probe via ${HOST_IP}"
healthy=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -skf -m 5 --resolve "${HEALTHZ_HOST}:443:${HOST_IP}" "https://${HEALTHZ_HOST}/healthz" >/dev/null; then
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

if [[ "${RUN_SCRAPER}" == "1" ]]; then
  echo "==> running one-shot scraper"
  ssh "${HOST}" "cd ${DEST} && ${COMPOSE} build scraper && ${COMPOSE} run --rm scraper"
fi

echo "Done."
