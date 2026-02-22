# Browser Control Feature

Gigi supports browser automation via a shared Chrome container accessed through the Chrome DevTools Protocol (CDP). The agent controls the browser via the `chrome-devtools` MCP server, and the user can watch/interact via noVNC in the UI.

## Features

- **CDP-based automation**: Full browser control via Chrome DevTools Protocol MCP tools
- **Shared browser**: Both agent and user share the same Chrome instance
- **noVNC viewer**: User watches the browser in real-time via noVNC iframe
- **MCP Tool Integration**: Control browser through natural language commands
- **WebSocket API**: Real-time screenshot updates and command handling

## Configuration

```bash
# Chrome DevTools Protocol URL (set by your Chrome container)
CHROME_CDP_URL=ws://chrome:9222

# WebSocket server port for browser control UI
WS_PORT=3001
```

## Architecture

```
┌─────────────────────────────────┐
│   Chrome Container              │
│   (Xvfb + Chrome + noVNC)      │
│   ├── CDP on :9222             │
│   └── noVNC on :6080           │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│   Gigi Agent                    │
│   ├── chrome-devtools MCP       │
│   │   (navigate, click, etc.)   │
│   └── Headless Playwright       │
│       (fallback automation)     │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│   Gigi UI (Browser tab)         │
│   └── noVNC iframe              │
└─────────────────────────────────┘
```

## Usage

### Via chrome-devtools MCP (primary)

The agent uses MCP tools for browser control:

- `navigate_page` — Open a URL
- `take_screenshot` — Capture the page
- `take_snapshot` — Get DOM accessibility tree
- `click` / `fill` / `hover` — Interact with elements
- `evaluate_script` — Run JavaScript in page context
- `list_network_requests` — Inspect network traffic

### Via Web UI

The user sees the shared browser in the Browser tab of the Gigi UI, rendered via noVNC iframe. The user can interact with the browser directly.

## Security Considerations

- Chrome runs with `--no-sandbox` in container (required for Docker)
- The Chrome container provides an isolated browser environment
- WebSocket connections should use authentication in production

## Troubleshooting

1. **Browser not loading**: Check if the Chrome container is running and `CHROME_CDP_URL` is set
2. **noVNC not displaying**: Verify the Chrome container exposes port 6080 for noVNC
3. **Screenshots not updating**: Verify WebSocket connection on the configured WS_PORT
