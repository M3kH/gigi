#!/bin/bash
# Backup the production database before running integration tests.
# Creates a timestamped SQL dump in /workspace/backups/
#
# Uses psql COPY commands instead of pg_dump to avoid version mismatch
# issues between client and server.
#
# Usage: ./scripts/backup-db.sh
#        npm run test:integration  (calls this automatically via pretest:integration)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/workspace/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_URL="${DATABASE_URL:-postgresql://gigi_prod:gigi_prod_secret@postgres:5432/gigi_prod}"

# Parse connection string
DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:]+):.*|\1|')
DB_PORT=$(echo "$DB_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')
DB_USER=$(echo "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_PASS=$(echo "$DB_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')

BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Backing up ${DB_NAME} → ${BACKUP_FILE}"

# Use psql to generate a portable dump (avoids pg_dump version mismatch)
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" -t -A <<'SQL' | gzip > "$BACKUP_FILE"
-- Export all tables as COPY statements
-- Config
SELECT 'TRUNCATE config, conversations, messages, action_log CASCADE;';
\copy config TO STDOUT WITH CSV HEADER
SELECT '';

-- Conversations
SELECT '-- conversations';
\copy conversations TO STDOUT WITH CSV HEADER

-- Messages
SELECT '-- messages';
\copy messages TO STDOUT WITH CSV HEADER

-- Action log
SELECT '-- action_log';
\copy action_log TO STDOUT WITH CSV HEADER
SQL

# Keep only last 5 backups to avoid filling disk
ls -t "${BACKUP_DIR}/${DB_NAME}"_*.sql.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] ✅ Done (${SIZE})"
