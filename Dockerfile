# ── Stage 1: Install dependencies ─────────────────────────────────────
FROM node:22 AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm ci

# ── Stage 2: Build all packages (shared → server → client) ───────────
FROM deps AS build

COPY . .

RUN npm run build

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

# Copy server dist + production node_modules
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/node_modules ./node_modules

# Copy client build output (served by Hono serveStatic in production mode)
COPY --from=build /app/packages/client/dist ./packages/client/dist

# Copy .pi/skills/ — reading skills for the AI (interactive-reading, etc.)
COPY --from=build /app/.pi ./.pi

ENV NODE_ENV=production
ENV PORT=3847
ENV LIBRARY_PATH=/library
ENV DATA_PATH=/data

EXPOSE 3847

CMD ["node", "packages/server/dist/index.js"]
