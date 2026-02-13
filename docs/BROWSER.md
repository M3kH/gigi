# Browser Control Feature

Gigi now supports browser automation with both headless and interactive modes using Playwright and Neko.

## Features

- **Headless Mode**: Fast, automated browser control using Playwright
- **Interactive Mode**: Visual browser interaction through Neko (browser streaming)
- **MCP Tool Integration**: Control browser through natural language commands
- **Web UI**: Real-time browser control interface at `/browser`
- **WebSocket API**: Real-time screenshot updates and control

## Configuration

Set browser mode via environment variable:
```bash
BROWSER_MODE=headless  # Default: headless automation
BROWSER_MODE=interactive  # Visual browser with Neko
```

### Neko Configuration
```bash
NEKO_HOST=gigi-neko      # Neko container hostname
NEKO_PORT=8080           # Neko web port
NEKO_PASSWORD=neko       # Neko password
WS_PORT=3001             # WebSocket server port
```

## Usage

### 1. Using MCP Browser Tool

```javascript
// Navigate to a URL
await browser({ action: 'navigate', url: 'https://example.com' })

// Click an element
await browser({ action: 'click', selector: '#submit-button' })

// Type text
await browser({ action: 'type', selector: 'input#search', text: 'query' })

// Take screenshot
await browser({ action: 'screenshot' })

// Switch modes
await browser({ action: 'switch_mode', mode: 'interactive' })

// Get browser status
await browser({ action: 'status' })
```

### 2. Using Web UI

Access the browser control interface at: `http://localhost:3000/browser`

Features:
- URL navigation bar
- Back/Forward/Refresh buttons
- Mode switching (Headless ↔ Interactive)
- Screenshot capture
- Console output
- Real-time updates via WebSocket

### 3. Docker Compose Setup

The deployment now uses a single docker-compose.yml that includes both services:
```bash
docker-compose up -d
```

This starts:
- Gigi with browser support (configurable via BROWSER_MODE env var)
- Neko container for interactive browser sessions (using custom Dockerfile.neko)
- WebSocket server on port 3001

For headless-only mode, you can disable the Neko service:
```bash
docker-compose up -d gigi
```

## Architecture

```
┌─────────────────────────────────┐
│   Gigi MCP Tool                 │
│   (Natural language commands)   │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│   Browser Manager               │
│   ├── Headless (Playwright)     │
│   └── Interactive (Neko)        │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│   WebSocket Server (Port 3001)  │
│   ├── Screenshot streaming      │
│   └── Command handling          │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│   Web UI (/browser)             │
│   ├── Visual controls           │
│   └── Mode switching            │
└─────────────────────────────────┘
```

## Security Considerations

- Chromium runs with `--no-sandbox` in container (required for Docker)
- Neko provides isolated browser environment
- WebSocket connections should use authentication in production
- Consider network policies to restrict browser access

## Troubleshooting

1. **Playwright fails to launch**: Ensure all Chromium dependencies are installed
2. **Neko connection fails**: Check if Neko container is running and accessible
3. **Screenshots not updating**: Verify WebSocket connection on port 3001
4. **Mode switching fails**: Browser manager needs to restart, may take a few seconds

## Future Enhancements

- [ ] Browser profile persistence
- [ ] Multi-tab support
- [ ] Network request interception UI
- [ ] Cookie management interface
- [ ] WebRTC support for Neko audio/video