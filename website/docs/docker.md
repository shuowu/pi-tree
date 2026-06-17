---
title: Docker Deployment
description: Deploy pi-tree with Docker — pre-built images, Docker Compose, volumes, and building from source.
---

# Docker Deployment

Pi-tree publishes pre-built Docker images to GitHub Container Registry on every release, supporting both `linux/amd64` and `linux/arm64` architectures.

## Quick Start

Pull the latest image and run:

```bash
docker pull ghcr.io/shuowu/pi-tree:latest
```

```bash
docker run -d --name pi-tree \
  --env-file .env \
  -p 3847:3847 \
  -v pi-tree-data:/data \
  ghcr.io/shuowu/pi-tree:latest
```

Open **http://localhost:3847** — Docker serves both the frontend and API on a single port.

:::tip
If you haven't configured your `.env` yet, see [Getting Started](/docs/getting-started#option-2-docker-quick-start) for the initial setup steps.
:::

## Docker Compose

Docker Compose is the recommended way to manage pi-tree in production.

### Basic Setup

```yaml
services:
  pi-tree:
    build: .
    ports:
      - "3847:3847"
    environment:
      - PI_PROVIDER=anthropic
      - PI_API_KEY=${PI_API_KEY}
      - PI_MODEL=claude-sonnet-4-20250514
    volumes:
      - pi-tree-data:/data              # all state: DB, sessions, library

volumes:
  pi-tree-data:
```

### With Custom Skills and Extensions

```yaml
volumes:
  - ./my-skills:/data/skills:ro        # your custom skills
  - ./my-extensions:/data/extensions:ro # your custom extensions
```

See [Custom Skills](/docs/self-hosting#custom-skills) and [Custom Extensions](/docs/self-hosting#custom-extensions) for how to create them.

### With MCP Tools (Web Search, etc.)

```yaml
volumes:
  - ./mcp.json:/data/mcp.json:ro       # MCP server config
```

See [MCP Bridge](/docs/self-hosting#mcp-bridge) for setup and available servers.

### Using a Local LLM

If you're running [Ollama](https://ollama.com/download), [LM Studio](https://lmstudio.ai/), or another local model server on the host machine, there are a few networking and compatibility details to get right.

#### 1. Enable Docker-to-host networking

Docker containers can't reach `localhost` on the host. You need `host.docker.internal` to resolve to the host machine:

```yaml
services:
  pi-tree:
    # ... your other config ...
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

:::info
`extra_hosts` is required on **Linux**. On Docker Desktop (macOS/Windows), `host.docker.internal` works out of the box — but adding it explicitly doesn't hurt.
:::

#### 2. Bind your model server to all interfaces

Local model servers typically bind to `127.0.0.1` (localhost only) by default. Docker containers connect via the host's bridge IP, so the server must listen on `0.0.0.0`:

**Ollama** — listens on `0.0.0.0` by default. No changes needed.

**LM Studio** — binds to `127.0.0.1` by default. Change it:

```bash
# Via CLI (preferred)
lms server stop
lms server start --bind 0.0.0.0

# Or edit ~/.lmstudio/.internal/http-server-config.json
# Change "networkInterface": "127.0.0.1" → "networkInterface": "0.0.0.0"
```

#### 3. Configure the provider

**Simple setup** (single local provider via env vars):

```yaml
environment:
  - PI_PROVIDER=ollama
  - PI_API_KEY=not-needed
  - PI_BASE_URL=http://host.docker.internal:11434/v1
  - PI_MODEL=gemma4:12b
```

**Multi-provider setup** (local + cloud via `models.json`):

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://host.docker.internal:1234/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "compat": { "supportsDeveloperRole": false },
      "models": [
        { "id": "qwen/qwen3.6-27b" }
      ]
    },
    "deepseek": {
      "apiKey": "$DEEPSEEK_API_KEY",
      "models": [
        { "id": "deepseek-v4-flash" }
      ]
    }
  }
}
```

Mount the file into the container:

```yaml
volumes:
  - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
```

:::tip Compatibility flags
Local model servers don't always support all OpenAI API features. The `compat` field tells pi-tree how to adapt:

| Flag | Default | When to set `false` |
|------|---------|-------------------|
| `supportsDeveloperRole` | `true` | LM Studio, Ollama, and most local servers only support `system` and `user` roles — not the `developer` role. Set this to `false` to avoid silent failures. |

If your local model returns empty responses or hangs, missing `compat` flags are usually the cause.
:::

#### Complete Docker Compose example

A full working setup with a local LM Studio provider and a cloud fallback:

```yaml
services:
  pi-tree:
    build: .
    restart: unless-stopped
    ports:
      - "3847:3847"
    env_file: .env
    volumes:
      - ${PI_TREE_DATA:-./data}:/data
      - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
    environment:
      - DATA_PATH=/data
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### Multi-Provider

To use multiple LLM providers, mount a `models.json` file:

```yaml
volumes:
  - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
```

See [Models & Providers](/docs/models#multi-provider-setup) for details on configuring `models.json`.

## Volumes

| Mount Point | Purpose | Access |
|-------------|---------|--------|
| `/data` | All state — database, sessions, library, processed content | Read-write |

The `/data` volume contains everything pi-tree needs: the SQLite database, session files, uploaded books, processed content, and user configuration. Books are uploaded through the UI or placed in `<DATA_PATH>/library/`.

## Build from Source

If you prefer to build the image locally instead of using the pre-built one:

```bash
docker compose up --build
```

This builds the image from the `Dockerfile` in the repository root and starts the container.

## What's Next?

- **[Self-Hosting](/docs/self-hosting)** — Environment variables, custom skills, MCP bridge, news feeds, and all configuration options
- **[Models & Providers](/docs/models)** — Configure cloud APIs, local models, or multi-provider setups
