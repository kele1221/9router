#!/bin/bash
set -e

PORT=20128
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/server.log"
BOOT_LOG="$DIR/logs/boot.log"

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
mkdir -p "$DIR/logs"
cd "$DIR"

# Leave a live server alone; this only intends to bring one up at boot/login.
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') port $PORT already in use, skipping." >> "$BOOT_LOG"
  exit 0
fi

# Rebuild only when sources changed since the last build, so boot stays fast.
if [ ! -f .next/BUILD_ID ] || \
   find src open-sse cli custom-server.js next.config.mjs package.json \
     -newer .next/BUILD_ID -print -quit | grep -q .; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') rebuilding (sources changed)..." >> "$BOOT_LOG"
  npm run build >> "$BOOT_LOG" 2>&1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') starting 9router on port $PORT" >> "$BOOT_LOG"
nohup env PORT="$PORT" HOSTNAME=0.0.0.0 node custom-server.js --port "$PORT" >> "$LOG" 2>&1 &
