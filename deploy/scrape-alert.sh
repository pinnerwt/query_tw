#!/usr/bin/env bash
# Telegram alert when the cuizhao scraper stops fetching new posts.
#
# Runs after each scraper pass (see deploy/cuizhao-scrape.cron). Reads the
# last N `{"event":"done",...}` lines from scrape.log and pings Telegram
# when all of them have `"enqueued":0` — the signal that Threads has
# expired the session (or the cookies in state.json are otherwise dead).
#
# Single-zero-run alerts would be noisy: even with a healthy session, a
# given hour can legitimately produce no new posts for niche queries.
# Requiring a streak filters that out.
#
# Env (read from .env if not set):
#   TELEGRAM_BOT_TOKEN     required — no-op if empty
#   TELEGRAM_CHAT_ID       required — no-op if empty
#   ALERT_LOOKBACK         consecutive 0-enqueued runs needed (default 6)
#   ALERT_COOLDOWN_HOURS   min hours between alerts (default 12)
#   SCRAPE_LOG             default /home/ubuntu/cuizhao/scrape.log
#   ALERT_STATE            default /home/ubuntu/cuizhao/.alert-state
set -euo pipefail

LOG="${SCRAPE_LOG:-/home/ubuntu/cuizhao/scrape.log}"
STATE="${ALERT_STATE:-/home/ubuntu/cuizhao/.alert-state}"
LOOKBACK="${ALERT_LOOKBACK:-6}"
COOLDOWN_HOURS="${ALERT_COOLDOWN_HOURS:-12}"
ENV_FILE="${ENV_FILE:-/home/ubuntu/cuizhao/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
  exit 0
fi

[[ -f "$LOG" ]] || exit 0

mapfile -t recent < <(grep -E '"event":"done"' "$LOG" | tail -n "$LOOKBACK")
if (( ${#recent[@]} < LOOKBACK )); then
  exit 0
fi

for line in "${recent[@]}"; do
  if ! [[ "$line" =~ \"enqueued\":0[,}] ]]; then
    exit 0
  fi
done

now=$(date +%s)
last_alert=0
if [[ -f "$STATE" ]]; then
  last_alert=$(cat "$STATE" 2>/dev/null || echo 0)
  [[ "$last_alert" =~ ^[0-9]+$ ]] || last_alert=0
fi
if (( now - last_alert < COOLDOWN_HOURS * 3600 )); then
  exit 0
fi

host=$(hostname -s 2>/dev/null || echo "?")
msg="⚠️ cuizhao scraper (${host}): last ${LOOKBACK} runs each returned 0 new posts. Threads session likely expired — regenerate state.json locally with playwright codegen and run ./deploy/deploy-monitor.sh scrape."

http_code=$(curl -sS -m 10 -o /tmp/cuizhao-alert.out -w '%{http_code}' \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${msg}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" || echo "000")

if [[ "$http_code" == "200" ]]; then
  echo "$now" > "$STATE"
  echo "{\"event\":\"alert_sent\",\"reason\":\"zero_enqueued_streak\",\"lookback\":${LOOKBACK}}"
else
  echo "{\"event\":\"alert_failed\",\"http\":\"${http_code}\",\"body\":$(jq -Rsa . </tmp/cuizhao-alert.out 2>/dev/null || echo '""')}"
  exit 1
fi
