#!/bin/bash
set -e

WORKER_COUNT=${WORKER_COUNT:-2}
WORKER_PIDS=()

# Start Rust workers in background
for i in $(seq 1 "$WORKER_COUNT"); do
  /app/rust-worker &
  WORKER_PIDS+=($!)
done

# Trap signals to forward to all workers
trap 'for pid in "${WORKER_PIDS[@]}"; do kill "$pid" 2>/dev/null; done; wait; exit 0' SIGTERM SIGINT

# Start Gunicorn in foreground
cd /app/backend
exec gunicorn \
  --config /app/docker/gunicorn.conf.py \
  wsgi:app
