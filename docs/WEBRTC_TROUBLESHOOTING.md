# WebRTC Troubleshooting Guide

## Common Issues and Solutions

### ICE Failed Error

If you see errors like:
```
WebRTC: ICE failed, add a TURN server and see about:webrtc for more details
```

This typically means the WebRTC connection cannot establish due to NAT traversal issues.

### Solutions

1. **Configure NAT1TO1 Address**

   The most important configuration for WebRTC in a local network is setting the `NEKO_NAT1TO1` environment variable:

   ```env
   # In your .env file
   NEKO_NAT1TO1=<your-host-ip>  # Your host's LAN IP address
   ```

2. **Ensure UDP Ports Are Open**

   WebRTC requires UDP ports 52000-52100 to be accessible. The docker-compose.yml should include:

   ```yaml
   ports:
     - "52000-52100:52000-52100/udp"
   ```

3. **STUN Server Configuration**

   STUN servers help with NAT traversal. The default configuration includes Google's public STUN servers:

   ```yaml
   environment:
     NEKO_ICESERVERS: '[{"urls":["stun:stun.l.google.com:19302"]}]'
   ```

### Debugging Steps

1. **Check Browser Console**
   - Open browser developer tools (F12)
   - Look for WebRTC-related errors
   - Check the Network tab for failed WebSocket connections

2. **Verify Connectivity**
   ```bash
   # Test if neko service is running
   curl http://neko.example.com

   # Check if UDP ports are listening
   sudo netstat -tulpn | grep 52000
   ```

3. **Firefox about:webrtc**
   - Navigate to `about:webrtc` in Firefox
   - Check ICE connection state and candidates
   - Look for any failed STUN/TURN requests

### Network Architecture

```
Browser → Caddy (HTTPS) → Neko WebSocket (signaling)
    ↓
WebRTC UDP (52000-52100) ← Direct connection for media
```

The signaling happens over WebSocket through Caddy, but the actual media streams use direct UDP connections.

### Environment Variables Reference

- `NEKO_NAT1TO1`: External IP address for ICE candidates
- `NEKO_EPR`: Ephemeral port range for WebRTC (default: 52000-52100)
- `NEKO_ICELITE`: Enable ICE lite mode (simplified NAT traversal)
- `NEKO_ICESERVERS`: JSON array of STUN/TURN servers

### Testing WebRTC

1. Access the browser control at https://gigi.example.com/browser-control.html
2. Switch to "Interactive" mode
3. Check browser console for any errors
4. If connection fails, verify NAT1TO1 is set correctly