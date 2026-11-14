#!/bin/bash
set -e

WORKER_COUNT=${WORKER_COUNT:-2}
WORKER_RESTART_DELAY=${WORKER_RESTART_DELAY:-5}
WORKER_BIN=${WORKER_BIN:-/app/rust-worker}
RUN_DIR=${RUN_DIR:-/tmp/blocklist-worker}
STOP_FILE="$RUN_DIR/stop"

mkdir -p "$RUN_DIR"
rm -f "$STOP_FILE" "$RUN_DIR"/worker-*.pid

SUPERVISOR_PIDS=()
GUNICORN_PID=""

supervise_worker() {
  set +e
  local index=$1
  local pid_file="$RUN_DIR/worker-$index.pid"

  while [ ! -f "$STOP_FILE" ]; do
    "$WORKER_BIN" &
    local worker_pid=$!
    echo "$worker_pid" > "$pid_file"

    wait "$worker_pid"
    local code=$?
    rm -f "$pid_file"

    if [ -f "$STOP_FILE" ]; then
      break
    fi

    echo "[entrypoint] rust-worker $index exited with code $code, restarting in ${WORKER_RESTART_DELAY}s" >&2
    sleep "$WORKER_RESTART_DELAY"
  done
}

shutdown() {
  touch "$STOP_FILE"

  local worker_pids=()
  for pid_file in "$RUN_DIR"/worker-*.pid; do
    [ -f "$pid_file" ] || continue
    worker_pids+=("$(cat "$pid_file")")
    kill "${worker_pids[-1]}" 2>/dev/null
  done

  for pid in "${SUPERVISOR_PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done

  if [ -n "$GUNICORN_PID" ]; then
    kill -TERM "$GUNICORN_PID" 2>/dev/null
    wait "$GUNICORN_PID" 2>/dev/null
  fi

  for pid in "${worker_pids[@]}"; do
    while kill -0 "$pid" 2>/dev/null; do
      sleep 0.1
    done
  done

  exit 0
}

trap shutdown SIGTERM SIGINT

# Start Rust workers under supervision
for i in $(seq 1 "$WORKER_COUNT"); do
  supervise_worker "$i" &
  SUPERVISOR_PIDS+=($!)
done

# Start Gunicorn
cd /app/backend
gunicorn \
  --config /app/docker/gunicorn.conf.py \
  wsgi:app &
GUNICORN_PID=$!

wait "$GUNICORN_PID"
