#!/bin/sh
# Deploy Gitea custom templates to the production Gitea instance
#
# Usage: ./scripts/deploy-gitea-templates.sh [GITEA_HOST]
#
# Copies custom templates to Gitea's data directory and restarts
# the Gitea service to pick up changes.

set -e

GITEA_HOST="${1:?Usage: $0 <gitea-host>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATES_DIR="${SCRIPT_DIR}/../gitea/custom/templates"

if [ ! -d "$TEMPLATES_DIR" ]; then
  echo "ERROR: Templates not found at ${TEMPLATES_DIR}"
  exit 1
fi

PUBLIC_DIR="${SCRIPT_DIR}/../gitea/custom/public"

echo "Deploying Gitea templates to ${GITEA_HOST}..."

# Copy templates to Gitea data directory
ssh "${GITEA_HOST}" "mkdir -p /mnt/cluster-storage/docker/gitea/gitea/templates"
scp -r "${TEMPLATES_DIR}"/* "${GITEA_HOST}:/mnt/cluster-storage/docker/gitea/gitea/templates/"

# Copy public assets (logo, favicon) to Gitea custom directory
if [ -d "$PUBLIC_DIR" ]; then
  echo "Deploying Gitea public assets..."
  ssh "${GITEA_HOST}" "mkdir -p /mnt/cluster-storage/docker/gitea/custom/public/assets/img"
  scp -r "${PUBLIC_DIR}"/* "${GITEA_HOST}:/mnt/cluster-storage/docker/gitea/custom/public/"
fi

echo "Templates and assets deployed. Restart Gitea to pick up changes."
echo "  ssh ${GITEA_HOST} 'docker restart gitea'"
echo ""
echo "NOTE: To use logo.png, ensure app.ini has: [ui] APP_LOGO = assets/img/logo.png"
