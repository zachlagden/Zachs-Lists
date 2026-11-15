# Zach's Lists

A DNS blocklist aggregator at lists.zachlagden.uk. Open source, built to a professional standard.

## Layout

- `backend/`: Flask 3 API on Gunicorn with one gevent WebSocket worker, backed by MongoDB. It creates build jobs, serves the API and list files, runs APScheduler, and relays job progress to browsers over Socket.IO.
- `rust-worker/`: the build worker. It claims job documents from MongoDB, downloads sources, applies the whitelist and writes gzipped lists under `DATA_DIR`. There is no message broker.
- `frontend/`: React, Vite, Tailwind and Zustand. Flask serves the built files through WhiteNoise.
- `tests/fixtures/`: fixtures read by both the Python and Rust tests, so the two implementations stay in step. A rule both languages implement gets a shared fixture here.
- `docker/entrypoint.sh`: starts Gunicorn and supervises `WORKER_COUNT` workers in the one container.

## Stack exceptions

This project predates the usual defaults and keeps its own stack: MongoDB, Flask, and a React SPA built with Vite.

## Default lists

The default lists are built from the source config and whitelist in the `system_config` document `default_config`. When `DEFAULT_SYNC_ENABLED` is true, both come from [zachlagden/Pi-hole-Optimized-Blocklists](https://github.com/zachlagden/Pi-hole-Optimized-Blocklists) at the commit of its latest published build, and the admin editor is read-only. Change the default sources and whitelist in that repository, not here. `docs/default-list-sync.md` describes the sync, its settings and its schedule.

## Checks

Run all of these before merging. CI runs the same in `.github/workflows/checks.yml`.

```sh
uv venv .venv && uv pip install -r backend/requirements-dev.txt
PYTHONPATH=backend uv run --no-project pytest backend/tests --disable-warnings
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
cargo test --manifest-path rust-worker/Cargo.toml --locked
cargo fmt --manifest-path rust-worker/Cargo.toml --check
cargo clippy --manifest-path rust-worker/Cargo.toml --locked --all-targets -- -D warnings
```

The mypy command and its file list are in the workflow file. Add each new or changed Python module to that list. Backend tests use mongomock and need no database. The worker needs `pkg-config` and `libssl-dev` to build.

## Deploying

Coolify builds the root `Dockerfile` and is set to deploy on every push to `main`, through a GitHub webhook. A merge to `main` is a production release, and the restart interrupts any build in progress. The webhook has missed a push before, so after merging, confirm in Coolify that a deployment for the new commit started, and trigger one through the Coolify API if none did.

- Multi-step work goes through an integration branch, with each step a pull request into it. The integration branch merges to `main` once, when the release is ready.
- Back up the production database before a release that changes stored data.
- `docker-compose.yml` is for local development only.

## Versioning

A release bumps `frontend/package.json`, and `rust-worker/Cargo.toml` with `rust-worker/Cargo.lock`. The two carry separate version numbers. The backend has none.
