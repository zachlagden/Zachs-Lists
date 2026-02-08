# ==============================================================================
# Stage 1: Build Frontend
# ==============================================================================
FROM node:20-alpine AS frontend-build

WORKDIR /build/frontend

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY frontend/ ./

# Empty VITE_API_URL = same-origin requests in production
ENV VITE_API_URL=""
ARG VITE_SITE_URL
ENV VITE_SITE_URL=${VITE_SITE_URL}
RUN pnpm build

# ==============================================================================
# Stage 2: Build Rust Worker
# ==============================================================================
FROM rust:1.84-slim-bookworm AS rust-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build/rust-worker

# Cache dependency build
COPY rust-worker/Cargo.toml rust-worker/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src target/release/deps/blocklist_worker*

# Build actual worker
COPY rust-worker/src ./src
RUN cargo build --release

# ==============================================================================
# Stage 3: Runtime
# ==============================================================================
FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-build /build/frontend/dist ./frontend/dist/

# Copy Rust worker binary
COPY --from=rust-build /build/rust-worker/target/release/blocklist-worker ./rust-worker

# Copy Docker support files
COPY docker/entrypoint.sh docker/gunicorn.conf.py ./docker/

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Runtime defaults
ENV FLASK_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["/app/docker/entrypoint.sh"]
