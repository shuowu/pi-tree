# @pi-tree/rss-crawler

Standalone RSS feed crawler for [pi-tree](https://github.com/nicoseng/pi-tree). Runs as a lightweight Hono HTTP service on a NAS or home server, crawling RSS feeds 24/7 and serving them via API.

The pi-tree news plugin connects to this service via the `RSS_REMOTE_URL` environment variable, offloading feed crawling to a persistent process that runs independently of the main pi-tree server.

## Quick Start

### Docker (recommended)

```bash
# Pull the pre-built multi-arch image (amd64 + arm64)
docker pull ghcr.io/shuowu/pi-tree-rss-crawler:latest

# Or use docker compose (see docker-compose.yml)
docker compose up -d

# Check health
curl http://localhost:3948/health
```

### Updating

```bash
docker compose pull
docker compose up -d
```

### Without Docker

```bash
# From the monorepo root
npm install

# Development (with hot reload)
npm run dev -w @pi-tree/rss-crawler

# Production
npm run build -w @pi-tree/rss-crawler
npm run start -w @pi-tree/rss-crawler
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3948` | HTTP server port |
| `DATA_DIR` | `~/.local/share/pi-tree-crawler` | Data directory for SQLite DB and feed state |
| `CRAWLER_DATA` | `./data` | Host path for Docker bind mount (used in `docker-compose.yml`) |
| `RSS_API_KEY` | _(none)_ | Optional bearer token for API auth |
| `RSS_CRAWL_INTERVAL_MIN` | `15` | Minutes between automatic crawl cycles |

## Connecting pi-tree

Set these env vars on your **pi-tree server** to connect to the remote crawler:

```bash
# Point the news plugin at the crawler
RSS_REMOTE_URL=http://your-nas:3948

# If you set an API key on the crawler
RSS_API_KEY=your-secret-key
```

## API Reference

All `/api/*` endpoints require `Authorization: Bearer <RSS_API_KEY>` when `RSS_API_KEY` is set. The `/health` endpoint is always public.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{ status, feeds, lastCrawl, crawlIntervalMin }` |
| `GET` | `/api/feeds` | List all configured feeds |
| `POST` | `/api/feeds` | Add a feed — body: `{ id, name, url, tags? }` |
| `PUT` | `/api/feeds/:id` | Update a feed — body: `{ name?, url?, tags? }` |
| `DELETE` | `/api/feeds/:id` | Remove a feed |
| `GET` | `/api/tags` | List all unique feed tags (sorted string array) |
| `POST` | `/api/crawl` | Trigger an immediate crawl — returns `{ success, stats }` |
| `GET` | `/api/items` | Get latest RSS items — query: `?days=&feeds=&tags=&keyword=&limit=` |
| `GET` | `/api/aggregate` | Get aggregated/deduplicated items — query: `?days=&feeds=&tags=&similarityThreshold=&limit=&includeUrl=` |

### Examples

```bash
# List all feeds
curl http://localhost:3948/api/feeds

# Add a feed
curl -X POST http://localhost:3948/api/feeds \
  -H "Content-Type: application/json" \
  -d '{"id": "hn", "name": "Hacker News", "url": "https://hnrss.org/frontpage", "tags": ["tech"]}'

# Trigger a manual crawl
curl -X POST http://localhost:3948/api/crawl

# Get items from the last 2 days, filtered by tag
curl "http://localhost:3948/api/items?days=2&tags=tech"

# Get deduplicated/aggregated items
curl "http://localhost:3948/api/aggregate?days=1&similarityThreshold=0.6"
```

## Docker Compose with pi-tree

Run both pi-tree and the RSS crawler together:

```yaml
services:
  pi-tree:
    image: ghcr.io/shuowu/pi-tree:latest
    ports:
      - "3847:3847"
    environment:
      - RSS_REMOTE_URL=http://rss-crawler:3948
      - RSS_API_KEY=${RSS_API_KEY:-}
    volumes:
      - ${PI_TREE_DATA:-./pi-tree-data}:/data

  rss-crawler:
    image: ghcr.io/shuowu/pi-tree-rss-crawler:latest
    restart: unless-stopped
    ports:
      - "3948:3948"
    environment:
      - PORT=3948
      - RSS_CRAWL_INTERVAL_MIN=30
      - RSS_API_KEY=${RSS_API_KEY:-}
    volumes:
      - ${CRAWLER_DATA:-./crawler-data}:/data
```

## Data

All state is stored in `DATA_DIR` (bind-mounted to the host):

- `news.db` — SQLite database with feed configs and crawled items
- Default feeds are synced from `packages/plugin-news/config/default-feeds.yml` on every startup — new feeds in the config are automatically added without affecting existing feeds

