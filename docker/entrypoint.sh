#!/bin/bash
set -e

# Start Rust worker in background
/app/rust-worker &
WORKER_PID=$!

# Trap signals to forward to worker
trap "kill $WORKER_PID 2>/dev/null; wait $WORKER_PID 2>/dev/null; exit 0" SIGTERM SIGINT

# Start Gunicorn in foreground
cd /app/backend
exec gunicorn \
  --config /app/docker/gunicorn.conf.py \
  wsgi:app
