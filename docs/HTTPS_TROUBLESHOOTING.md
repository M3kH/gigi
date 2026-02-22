# HTTPS/WSS Troubleshooting Guide

## Common Issues

### 1. Module Loading Errors
**Symptom**: `Uncaught ReferenceError: module is not defined`

**Cause**: Using CommonJS modules in browser context

**Fix**: Use ES modules or browser-compatible builds:
- highlight.js: Use `@highlightjs/cdn-assets` instead of individual language files
- marked: Use the ESM build from `marked/lib/marked.esm.js`

### 2. WebSocket Security Errors
**Symptom**: `The operation is insecure` or connection failures

**Cause**: Mixed content - HTTPS page trying to connect to WS (not WSS)

**Fix**: Auto-detect protocol:
```javascript
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.hostname}:3001`;
```

### 3. EventSource/SSE Connection Issues
**Symptom**: SSE disconnects or fails to establish connection

**Possible causes**:
- Proxy buffering (Nginx, Cloudflare)
- CORS issues
- Mixed content

**Fixes**:
- Add `X-Accel-Buffering: no` header
- Use relative URLs for EventSource
- Ensure proper CORS headers if needed

## Testing

To test if running over HTTPS:
```javascript
console.log('Protocol:', window.location.protocol);
console.log('Is secure:', window.isSecureContext);
```

## Browser Control WebSocket

The browser control requires:
- Port 3001 for WebSocket communication (proxied through Caddy)

When using HTTPS, ensure:
1. WSS is available (Caddy handles TLS termination for the `/ws` path)
