#!/bin/bash
# Get the Gitea API token from Postgres config
# Usage: ./scripts/get-gitea-token.sh [host] [user]
#   host: SSH host to connect to
#   user: SSH user (default: current user)

HOST="${1:?Usage: $0 <host> [user]}"
SSH_USER="${2:-$(whoami)}"
CONTAINER_FILTER="${GIGI_CONTAINER_FILTER:-gigi_gigi}"

CONTAINER=$(ssh "${SSH_USER}@${HOST}" "sudo docker ps -q -f name=${CONTAINER_FILTER}" 2>/dev/null)

if [ -z "$CONTAINER" ]; then
  echo "Error: container matching '${CONTAINER_FILTER}' not found" >&2
  exit 1
fi

TOKEN=$(ssh "${SSH_USER}@${HOST}" "sudo docker exec $CONTAINER sh -c 'psql \$DATABASE_URL -t -A -c \"SELECT value FROM config WHERE key = '\\''gitea_token'\\''\"'" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "Error: could not retrieve gitea_token from config" >&2
  exit 1
fi

echo "$TOKEN"
