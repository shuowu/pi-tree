# ── Stage 1: Install dependencies ─────────────────────────────────────
FROM node:22 AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY packages/plugin-book/package.json ./packages/plugin-book/
COPY packages/plugin-news/package.json ./packages/plugin-news/
COPY packages/plugin-paper/package.json ./packages/plugin-paper/
COPY packages/plugin-youtube/package.json ./packages/plugin-youtube/
COPY packages/plugin-mcp/package.json ./packages/plugin-mcp/
COPY packages/ui/package.json ./packages/ui/
COPY packages/server/package.json ./packages/server/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/client/package.json ./packages/client/
COPY packages/electron/package.json ./packages/electron/

RUN npm ci

# ── Stage 2: Build all packages (shared → core → server → client) ────
FROM deps AS build

COPY . .

# Build only server-relevant packages (skip electron — needs native binaries)
RUN npm run build -w @pi-tree/shared \
 && npm run build -w @pi-tree/core \
 && npm run build -w @pi-tree/plugin-sdk \
 && npm run build -w pi-tree-book \
 && npm run build -w pi-tree-news \
 && npm run build -w pi-tree-paper \
 && npm run build -w pi-tree-youtube \
 && npm run build -w pi-tree-mcp \
 && npm run build -w @pi-tree/server \
 && npm run build -w @pi-tree/client

# ── Stage 3: Production runtime ──────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# better-sqlite3 needs these shared libs at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files (needed for workspace resolution)
COPY package.json package-lock.json ./

# Copy shared package (runtime dependency for server)
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

# Copy core package (runtime dependency for server)
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist

# Copy plugin-sdk (runtime dependency for server + plugins)
COPY --from=build /app/packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY --from=build /app/packages/plugin-sdk/dist ./packages/plugin-sdk/dist

# Copy plugin packages (skills, profiles, extensions, routes, source types)
# These are discovered at runtime by the agent registry via resolveCorePluginDirs()
COPY --from=build /app/packages/plugin-book ./packages/plugin-book
COPY --from=build /app/packages/plugin-news ./packages/plugin-news
COPY --from=build /app/packages/plugin-paper ./packages/plugin-paper
COPY --from=build /app/packages/plugin-youtube ./packages/plugin-youtube
COPY --from=build /app/packages/plugin-mcp ./packages/plugin-mcp

# Copy server dist + config + drizzle migrations + production node_modules
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/config ./packages/server/config
COPY --from=build /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=build /app/node_modules ./node_modules

# Copy client build output (served by Hono serveStatic in production mode)
COPY --from=build /app/packages/client/dist ./packages/client/dist

ENV NODE_ENV=production
ENV PORT=3847
ENV DATA_PATH=/data

EXPOSE 3847

CMD ["node", "packages/server/dist/index.js"]
