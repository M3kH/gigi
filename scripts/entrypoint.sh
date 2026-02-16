#!/bin/sh
# Gigi entrypoint — syncs Gitea custom templates then starts the app

# Sync Gitea custom templates to shared volume (if mounted)
# The volume is shared with the Gitea container and mounted at its
# /data/gitea/templates/ path. We copy custom/ and base/ dirs into it.
GITEA_TEMPLATES_TARGET="${GITEA_CUSTOM_PATH:-/gitea-custom}"
if [ -d /app/gitea/custom/templates ] && [ -d "$GITEA_TEMPLATES_TARGET" ]; then
  echo "[entrypoint] Syncing Gitea custom templates to $GITEA_TEMPLATES_TARGET ..."
  cp -r /app/gitea/custom/templates/* "$GITEA_TEMPLATES_TARGET/"
  echo "[entrypoint] Templates synced."
fi

# Start the app
exec node --import tsx src/index.ts
