# Browser Control Feature

Gigi includes a built-in Chrome browser inside the AIO container, accessed through the Chrome DevTools Protocol (CDP). The agent controls the browser via the `chrome-devtools` MCP server, and the user can watch/interact via noVNC in the UI.

## Features

- **CDP-based automation**: Full browser control via Chrome DevTools Protocol MCP tools
- **Shared browser**: Both agent and user share the same Chrome instance
- **noVNC viewer**: User watches the browser in real-time via noVNC iframe
- **MCP Tool Integration**: Control browser through natural language commands
- **Built into AIO**: No separate Chrome container needed — Chrome, Xvfb, and noVNC are bundled in the AIO image

## Configuration

Chrome is started automatically inside the AIO container. No configuration is needed for the default setup.

To use an **external** Chrome instance instead of the built-in one, set:

```bash
# Override to use external Chrome (skips internal Chrome in AIO)
CHROME_CDP_URL=ws://your-chrome-host:9222
```

## Architecture

```
+----------------------------------------------+
|   AIO Container                              |
|   +--------------------------------------+   |
|   |  Chrome (Xvfb + Chromium + noVNC)    |   |
|   |  +-- CDP on :9223 (nginx relay)      |   |
|   |  +-- noVNC on :6080                  |   |
|   +------------------+-------------------+   |
|                      |                       |
|   +------------------v-------------------+   |
|   |  Gigi Agent                          |   |
|   |  +-- chrome-devtools MCP             |   |
|   |      (navigate, click, screenshot)   |   |
|   +------------------+-------------------+   |
|                      |                       |
|   +------------------v-------------------+   |
|   |  Gigi UI (Browser tab)               |   |
|   |  +-- noVNC iframe at /browser/       |   |
|   +--------------------------------------+   |
+----------------------------------------------+
```

## Usage

### Via chrome-devtools MCP (primary)

The agent uses MCP tools for browser control:

- `navigate_page` -- Open a URL
- `take_screenshot` -- Capture the page
- `take_snapshot` -- Get DOM accessibility tree
- `click` / `fill` / `hover` -- Interact with elements
- `evaluate_script` -- Run JavaScript in page context
- `list_network_requests` -- Inspect network traffic

### Via Web UI

The user sees the shared browser in the Browser tab of the Gigi UI, rendered via noVNC iframe. The user can interact with the browser directly.

## Security Considerations

- Chrome runs with `--no-sandbox` inside the container (required for Docker)
- The AIO container provides an isolated browser environment
- WebSocket connections should use authentication in production

## Troubleshooting

1. **Browser not loading**: Check AIO container logs (`docker logs gigi`) -- look for Chrome/Xvfb startup errors
2. **noVNC not displaying**: Verify port 6080 is exposed and the AIO container is healthy
3. **CDP tools not working**: Check that nginx CDP relay is running on port 9223 inside the container
