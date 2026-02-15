#!/bin/sh
# Deploy Gitea custom templates to the production Gitea instance
#
# Usage: ./scripts/deploy-gitea-templates.sh [GITEA_HOST]
#
# Copies custom templates to Gitea's data directory and restarts
# the Gitea service to pick up changes.

set -e

GITEA_HOST="${1:-192.168.1.80}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATES_DIR="${SCRIPT_DIR}/../gitea/custom/templates"

if [ ! -d "$TEMPLATES_DIR" ]; then
  echo "ERROR: Templates not found at ${TEMPLATES_DIR}"
  exit 1
fi

echo "Deploying Gitea templates to ${GITEA_HOST}..."

# Copy templates to Gitea data directory
ssh "${GITEA_HOST}" "mkdir -p /mnt/cluster-storage/docker/gitea/gitea/templates"
scp -r "${TEMPLATES_DIR}"/* "${GITEA_HOST}:/mnt/cluster-storage/docker/gitea/gitea/templates/"

echo "Templates deployed. Restart Gitea to pick up changes."
echo "  ssh ${GITEA_HOST} 'docker restart gitea'"
