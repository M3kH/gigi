#!/bin/bash
set -e

# Custom entrypoint script for Neko
# This can be used to add custom initialization logic

# Example: Wait for dependent services
if [ -n "$WAIT_FOR_SERVICES" ]; then
    echo "Waiting for services: $WAIT_FOR_SERVICES"
    for service in $WAIT_FOR_SERVICES; do
        until nc -z "$service" 80 2>/dev/null; do
            echo "Waiting for $service..."
            sleep 2
        done
    done
fi

# Run the original neko entrypoint
exec /usr/bin/supervisord -c /etc/neko/supervisord.conf