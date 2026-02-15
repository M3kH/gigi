FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /var/log/chrome

COPY supervisord.conf /etc/supervisor/conf.d/chrome.conf
COPY cdp-proxy.conf /etc/nginx/conf.d/cdp-proxy.conf

EXPOSE 6080 9223

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/chrome.conf"]
