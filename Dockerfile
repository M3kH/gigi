FROM node:20-slim

RUN apt-get update && apt-get install -y \
  git curl ssh \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY src/ src/
COPY web/ web/

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "src/index.js"]
