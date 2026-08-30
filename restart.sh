#!/bin/bash
set -e

PORT=20128
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/server.log"

cd "$DIR"

echo "🔨 Building 9Router..."
npm run build

echo "🔍 Checking port $PORT..."

# Gracefully stop anything holding the port (children first, then parent),
# and wait for full exit so the new instance never races a dying process
# over the SQLite WAL.
for pid in $(lsof -ti:$PORT 2>/dev/null || true); do
  echo "💀 Stopping process tree: $pid"
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill -TERM "$child" 2>/dev/null || true
  done
  kill -TERM "$pid" 2>/dev/null || true
done

for i in $(seq 1 10); do
  if ! lsof -ti:$PORT >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Force-kill stragglers if graceful shutdown timed out
for pid in $(lsof -ti:$PORT 2>/dev/null || true); do
  echo "⚠️  Force-killing straggler: $pid"
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill -9 "$child" 2>/dev/null || true
  done
  kill -9 "$pid" 2>/dev/null || true
done

sleep 1

# Double-check port is free
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "❌ Port $PORT still occupied. Abort."
  exit 1
fi

mkdir -p "$(dirname "$LOG")"
echo "🚀 Starting 9Router on port $PORT in background..."
nohup env PORT=$PORT HOSTNAME=0.0.0.0 node custom-server.js --port $PORT >>"$LOG" 2>&1 &

sleep 2
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "✅ 9Router is running at http://localhost:$PORT"
  echo "   Log: $LOG"
else
  echo "⚠️  Server not ready yet, check: $LOG"
fi
