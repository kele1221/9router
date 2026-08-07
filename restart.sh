#!/bin/bash
set -e

PORT=20128
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔍 Checking port $PORT..."

# Kill anything on the port
PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "💀 Killing PID $PID on port $PORT..."
  kill -9 $PID 2>/dev/null || true
  sleep 1
fi

# Double-check port is free
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "❌ Port $PORT still occupied. Abort."
  exit 1
fi

echo "🚀 Starting 9Router fork on port $PORT..."
cd "$DIR"
PORT=$PORT HOSTNAME=0.0.0.0 npx next start --port $PORT
