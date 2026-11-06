# IA Burn — multi-stage, arch-agnostic image (linux/amd64 + linux/arm64).
# Build:  docker build -t ia-burn .
# Multi: docker buildx build --platform linux/amd64,linux/arm64 --output type=oci,dest=ia-burn.oci.tar -t ia-burn:latest .

# ---- Stage 1: build the frontend ----
FROM node:24-alpine AS build-frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# curl for the healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Backend dependencies (production only).
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Backend source and the built frontend.
COPY backend/ ./
COPY --from=build-frontend /build/dist ./frontend/dist

ENV NODE_ENV=production \
    CLAUDE_CONFIG_DIR=/data/claude \
    CODEX_HOME=/data/codex \
    CLAUDE_ACCOUNT_FILE=/data/claude-account.json \
    STATE_DIR=/data/state \
    ENTERPRISE_BUDGET=300 \
    PORT=8080

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/api/health || exit 1
CMD ["node", "src/server.js"]
