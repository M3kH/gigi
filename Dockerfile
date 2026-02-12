FROM node:20-slim

RUN apt-get update && apt-get install -y \
  git curl ssh \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash \
  || npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY src/ src/
COPY web/ web/
COPY mcp-config.json ./

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "src/index.js"]
