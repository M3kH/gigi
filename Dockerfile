FROM node:20-slim

RUN apt-get update && apt-get install -y \
  git curl ssh \
  chromium chromium-driver \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2 libatspi2.0-0 libgtk-3-0 \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash \
  || npm install -g @anthropic-ai/claude-code

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash gigi \
  && mkdir -p /workspace \
  && chown -R gigi:gigi /workspace

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY src/ src/
COPY web/ web/
COPY mcp-config.json ./
RUN chown -R gigi:gigi /app

USER gigi

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "src/index.js"]
