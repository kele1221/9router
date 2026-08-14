#!/bin/bash
set -e

PORT=20128
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/server.log"

cd "$DIR"

echo "🔨 Building 9Router..."
npm run build

echo "🔍 Checking port $PORT..."

# Kill anything on the port
PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "💀 Killing old process: $PID"
  kill -9 $PID 2>/dev/null || true
  sleep 1
fi

# Double-check port is free
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "❌ Port $PORT still occupied. Abort."
  exit 1
fi

mkdir -p "$(dirname "$LOG")"
echo "🚀 Starting 9Router on port $PORT in background..."
nohup env PORT=$PORT HOSTNAME=0.0.0.0 npx next start --port $PORT >>"$LOG" 2>&1 &

sleep 2
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "✅ 9Router is running at http://localhost:$PORT"
  echo "   Log: $LOG"
else
  echo "⚠️  Server not ready yet, check: $LOG"
fi
