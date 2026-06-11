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

If you're running [Ollama](https://ollama.com/download), [LM Studio](https://lmstudio.ai/), or another local model server on the host:

```yaml
environment:
  - PI_PROVIDER=openai           # Ollama exposes an OpenAI-compatible API
  - PI_API_KEY=not-needed
  - PI_BASE_URL=http://host.docker.internal:11434/v1
  - PI_MODEL=llama3.1:70b
```

:::warning
`host.docker.internal` works on Docker Desktop (macOS/Windows) and Docker Engine 20.10+ on Linux with `--add-host=host.docker.internal:host-gateway`. On older Linux setups, use the host's LAN IP instead.
:::

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
