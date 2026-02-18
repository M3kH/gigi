#!/bin/bash
# Get the Gitea API token from Postgres config
# Usage: ./scripts/get-gitea-token.sh [host]
#   host: SSH host to connect to (default: 192.168.1.110)

HOST="${1:-192.168.1.110}"
CONTAINER=$(ssh "m@$HOST" "sudo docker ps -q -f name=gigi-prod_gigi" 2>/dev/null)

if [ -z "$CONTAINER" ]; then
  echo "Error: gigi-prod_gigi container not found" >&2
  exit 1
fi

TOKEN=$(ssh "m@$HOST" "sudo docker exec $CONTAINER sh -c 'psql \$DATABASE_URL -t -A -c \"SELECT value FROM config WHERE key = '\\''gitea_token'\\''\"'" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "Error: could not retrieve gitea_token from config" >&2
  exit 1
fi

echo "$TOKEN"
