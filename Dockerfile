# ============================================
# MDM — Multi-stage Docker build (Snowpark Container Services)
# Stage 1: Build React UI
# Stage 2: Node.js server (API + static UI)
# Layout mirrors the repo (/app/mdm-api, /app/data, /app/postgres) so paths
# resolve the same way as in local development.
# ============================================

# --- Stage 1: Build React UI ---
FROM node:20-alpine AS ui-build
WORKDIR /app/ui
COPY mdm-ui/package.json mdm-ui/package-lock.json* ./
RUN npm ci
COPY mdm-ui/ ./
# vite only: type-checking is a CI step, not a packaging step
RUN npx vite build

# --- Stage 2: Production server ---
FROM node:20-alpine AS production
ENV NODE_ENV=production PORT=8080 BIND_HOST=0.0.0.0
WORKDIR /app/mdm-api

COPY mdm-api/package.json mdm-api/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY mdm-api/src ./src
COPY mdm-api/tsconfig.json ./
COPY --from=ui-build /app/ui/dist ./public
# Seed configuration and migrations (POST /api/auth/setup reads ../postgres)
COPY data /app/data
COPY postgres /app/postgres

USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1

EXPOSE 8080
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]
