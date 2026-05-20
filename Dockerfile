# SwingPro production container.
#
# Two-stage build:
#   1. builder — installs all deps (incl. dev) and builds the React SPA into dist/
#   2. runtime — installs prod-only deps, copies built SPA + server code
#
# better-sqlite3 is a native module. We need python3 + make + g++ in the
# builder stage so npm can compile it. The runtime stage carries only the
# pre-compiled .node binary, so it stays lean.
#
# Build:  docker build -t swingpro:latest .
# Run:    docker run --rm -p 51280:51280 --env-file .env -v swingpro-data:/app/data swingpro:latest
#
# For docker-compose, see docker-compose.yml.

# ============================================================
# Stage 1 — builder
# ============================================================
FROM node:20.19.2-bookworm-slim AS builder

# Build deps for better-sqlite3 (native compile)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (incl. devDependencies — Vite needs them)
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Copy source and build the SPA
COPY . .
RUN npm run build

# Prune to production-only deps for the runtime stage
RUN npm prune --omit=dev

# ============================================================
# Stage 2 — runtime
# ============================================================
FROM node:20.19.2-bookworm-slim AS runtime

# tzdata so TZ=Asia/Kolkata works correctly for the cron scheduler
RUN apt-get update && apt-get install -y --no-install-recommends \
      tzdata \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Kolkata \
    NODE_ENV=production \
    PORT=51280 \
    LOG_STDOUT_ONLY=1 \
    SWINGPRO_DB=/app/data/swingpro.db

WORKDIR /app

# Non-root user — the container should not run as root
RUN groupadd -r swingpro && useradd -r -g swingpro -d /app swingpro

# Copy pruned node_modules + built artifacts from the builder stage
COPY --from=builder --chown=swingpro:swingpro /app/node_modules ./node_modules
COPY --from=builder --chown=swingpro:swingpro /app/dist         ./dist
COPY --from=builder --chown=swingpro:swingpro /app/server.js    ./server.js
COPY --from=builder --chown=swingpro:swingpro /app/src          ./src
COPY --from=builder --chown=swingpro:swingpro /app/scripts      ./scripts
COPY --from=builder --chown=swingpro:swingpro /app/package.json ./package.json

# Persistent volume mount target — the DB and any backtest cache live here.
# Declare so docker-compose / Render disk mounts attach to a stable path.
RUN mkdir -p /app/data && chown -R swingpro:swingpro /app/data
VOLUME ["/app/data"]

USER swingpro

EXPOSE 51280

# Healthcheck — same endpoint the launchd watchdog probes on Mac.
# Note: the deep /api/health/macro is the canonical check; once cloud
# deployment adds a lightweight /health endpoint, switch this to that.
HEALTHCHECK --interval=60s --timeout=8s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||51280)+'/api/health/macro').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
