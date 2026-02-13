# Caddy Configuration for Gigi

This document explains the Caddy reverse proxy configuration required for Gigi to work properly, especially when served over HTTPS.

## Key Requirements

1. **WebSocket Support**: Browser control uses WebSocket on port 3001
2. **Server-Sent Events (SSE)**: Real-time updates use SSE on `/api/events`
3. **No Buffering**: Both WebSocket and SSE require immediate flushing

## Configuration Explained

```caddyfile
claude.cluster.local {
	# Handle WebSocket connections for browser control on /ws path
	@browserws {
		path /ws
		header Connection *Upgrade*
		header Upgrade websocket
	}
	reverse_proxy @browserws idea-biancifiore-gigi_gigi:3001

	# Ensure SSE/EventSource works properly
	@sse {
		path /api/events
	}
	handle @sse {
		reverse_proxy idea-biancifiore-gigi_gigi:3000 {
			# Disable buffering for SSE
			flush_interval -1
			# Long timeout for persistent connections
			transport http {
				read_timeout 0
				write_timeout 0
			}
		}
	}

	# Main application (all other requests)
	reverse_proxy idea-biancifiore-gigi_gigi:3000 {
		# Flush immediately for potential streaming responses
		flush_interval -1
	}
}
```

## Why This Configuration?

1. **WebSocket Proxy**: Instead of exposing port 3001, we proxy WebSocket through `/ws` path
   - Avoids mixed content issues (HTTPS page connecting to WS port)
   - Simplifies firewall/security configuration
   - Works seamlessly with HTTPS

2. **SSE Configuration**:
   - `flush_interval -1`: Disables buffering for real-time events
   - `read_timeout 0` and `write_timeout 0`: Allows persistent connections
   - Critical for live updates in the chat interface

3. **Order Matters**: WebSocket and SSE handlers come before the general reverse_proxy

## Testing

1. **WebSocket**: Open browser console and check:
   ```javascript
   new WebSocket('wss://claude.cluster.local/ws')
   ```

2. **SSE**: Test EventSource:
   ```javascript
   new EventSource('https://claude.cluster.local/api/events')
   ```

## Common Issues

- **Buffering**: If events are delayed, check for proxy buffering
- **Timeouts**: Long-running connections need timeout disabled
- **HTTPS**: Ensure WebSocket uses `wss://` when page is HTTPS