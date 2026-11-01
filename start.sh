#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -z "${DISCORD_TOKEN:-}" ]]; then
  echo "[Startup] DISCORD_TOKEN is required."
  exit 1
fi

export LAVALINK_PASSWORD="${LAVALINK_PASSWORD:-change-this-lavalink-password}"
export LAVALINK_HOST="127.0.0.1"
export LAVALINK_PORT="2333"

mkdir -p "${DATA_DIR:-/app/data}"

echo "[Startup] Starting Lavalink..."
java -jar /app/Lavalink.jar --spring.config.location=file:/app/lavalink/application.yml &
LAVA_PID=$!
NODE_PID=""

cleanup() {
  echo "[Startup] Stopping BauaaCore and Lavalink..."
  [[ -n "$NODE_PID" ]] && kill -TERM "$NODE_PID" 2>/dev/null || true
  kill -TERM "$LAVA_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  wait "$LAVA_PID" 2>/dev/null || true
}
trap cleanup TERM INT

ready=0
for i in $(seq 1 90); do
  if ! kill -0 "$LAVA_PID" 2>/dev/null; then
    echo "[Startup] Lavalink exited before becoming ready."
    wait "$LAVA_PID" || true
    exit 1
  fi
  if curl -fsS -H "Authorization: ${LAVALINK_PASSWORD}" http://127.0.0.1:2333/version >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "[Startup] Lavalink did not become ready within 180 seconds."
  exit 1
fi

echo "[Startup] Lavalink is ready. Starting Discord bot..."
node /app/src/index.js &
NODE_PID=$!

set +e
wait -n "$NODE_PID" "$LAVA_PID"
STATUS=$?
set -e
cleanup
exit "$STATUS"
