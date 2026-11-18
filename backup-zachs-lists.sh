#!/bin/bash
set -euo pipefail
# Owner-only backup directory and archive (.env and a full database dump).
umask 077

# =============================================================================
# Zach's Lists Backup Script
# Creates a complete backup of .env, ./data, and MongoDB as a single tar.gz.
# Set BACKUP_PASSPHRASE_FILE to a file containing a passphrase to encrypt the
# archive (writes .tar.gz.gpg and removes the plaintext archive).
# =============================================================================

# Fail before writing secrets when encryption was requested but cannot run.
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  if ! command -v gpg >/dev/null 2>&1; then
    echo "❌ BACKUP_PASSPHRASE_FILE is set, but gpg was not found on PATH."
    echo "   Install GnuPG, or unset BACKUP_PASSPHRASE_FILE for an unencrypted archive."
    exit 1
  fi
  if [ ! -f "${BACKUP_PASSPHRASE_FILE}" ] || [ ! -r "${BACKUP_PASSPHRASE_FILE}" ]; then
    echo "❌ BACKUP_PASSPHRASE_FILE is not a readable file: ${BACKUP_PASSPHRASE_FILE}"
    exit 1
  fi
fi

BACKUP_ROOT="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="zachs-lists_${TIMESTAMP}"
BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_NAME}"
ARCHIVE_FILE="${BACKUP_ROOT}/${BACKUP_NAME}.tar.gz"
MONGO_CONTAINER="zachs-lists-db"
DATA_DIR="./data"

echo "=== Zach's Lists Backup ==="
mkdir -p "${BACKUP_DIR}"

# 1. Backup .env
if [ -f .env ]; then
  echo "→ Backing up .env"
  cp .env "${BACKUP_DIR}/.env"
else
  echo "⚠  No .env found — skipping"
fi

# 2. Backup the data directory (generated lists + cache)
if [ -d "${DATA_DIR}" ]; then
  echo "→ Backing up ./data directory"
  tar -czf "${BACKUP_DIR}/data.tar.gz" -C . data
else
  echo "⚠  No ./data directory found — skipping"
fi

# 3. Backup MongoDB
if docker ps --format '{{.Names}}' | grep -q "^${MONGO_CONTAINER}$"; then
  echo "→ Dumping MongoDB (database: blocklist)..."
  docker exec "${MONGO_CONTAINER}" mongodump --archive --gzip > "${BACKUP_DIR}/mongo.archive.gz"
else
  echo "❌ MongoDB container '${MONGO_CONTAINER}' is not running!"
  echo "   Start it with: docker compose up -d"
  exit 1
fi

# 4. Save docker-compose.yml for reference
cp docker-compose.yml "${BACKUP_DIR}/" 2>/dev/null || true

# Create manifest
cat > "${BACKUP_DIR}/MANIFEST.txt" << EOF
Zach's Lists Backup
Created: $(date)
Hostname: $(hostname)
Mongo container: ${MONGO_CONTAINER}
Database: blocklist
EOF

# 5. Create single tar.gz archive
echo "→ Creating single archive: ${ARCHIVE_FILE}"
tar -czf "${ARCHIVE_FILE}" -C "${BACKUP_ROOT}" "${BACKUP_NAME}"

# Clean up the intermediate folder
rm -rf "${BACKUP_DIR}"

chmod 600 "${ARCHIVE_FILE}"

if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "→ Encrypting archive"
  if ! gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_PASSPHRASE_FILE}" -c "${ARCHIVE_FILE}"; then
    echo "❌ Encryption failed. Plaintext archive kept at ${ARCHIVE_FILE}"
    exit 1
  fi
  rm -f "${ARCHIVE_FILE}"
  ARCHIVE_FILE="${ARCHIVE_FILE}.gpg"
  chmod 600 "${ARCHIVE_FILE}"
fi

echo ""
echo "✅ Backup complete!"
echo "   Archive: ${ARCHIVE_FILE}"
echo ""
ls -lh "${ARCHIVE_FILE}"
echo ""
if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  echo "Decrypt and extract with:"
  echo "  gpg -d ${ARCHIVE_FILE} | tar xz"
  echo "Then pass the extracted directory to ./restore-zachs-lists.sh"
else
  echo "Transfer this single file to the new machine, then run:"
  echo "  ./restore-zachs-lists.sh ${ARCHIVE_FILE}"
fi
