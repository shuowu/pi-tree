---
title: Getting Started
description: Set up pi-tree in minutes — desktop app, Docker, or from source.
---

# Getting Started

There are three ways to run pi-tree. The desktop app is the easiest — no Node.js, no Docker, no terminal.

## Option 1: Desktop App (Recommended)

Download the desktop app and run it. Everything is bundled — the server, client, and database all run inside a single application.

### 1. Download

Go to the [latest release](https://github.com/shuowu/pi-tree/releases/latest) and download the installer for your platform:

| Platform | Format | Notes |
|----------|--------|-------|
| **macOS** | `.dmg` | Universal binary (Intel + Apple Silicon) |
| **Linux** | `.AppImage` | Portable, no install needed — just make executable and run |
| **Linux** | `.deb` | For Debian/Ubuntu — `sudo dpkg -i pi-tree-*.deb` |
| **Windows** | `.exe` installer | Standard Windows installer |

### 2. Configure

On first launch, you'll be prompted to configure your AI model. You need either:

- **A cloud API key** — from DeepSeek, Google, Anthropic, OpenAI, or Zhipu (see [Models & Providers](/docs/models) for the cheapest options)
- **A local model server** — [Ollama](https://ollama.com/download) or [LM Studio](https://lmstudio.ai/) running on your machine

### 3. Start reading

Add a book (EPUB, MOBI, PDF), an RSS feed, or another source from the Library — and start a conversation.

:::tip
The desktop app stores all data in your user directory (`~/Library/Application Support/pi-tree` on macOS, `~/.config/pi-tree` on Linux, `%APPDATA%/pi-tree` on Windows). Your sessions, sources, and configuration are always local.
:::

## Option 2: Docker

Docker is the best option for running pi-tree as a self-hosted service, especially on a home server or NAS. Pre-built images are published to GitHub Container Registry on every release, supporting both `linux/amd64` and `linux/arm64`.

### 1. Pull the image

```bash
docker pull ghcr.io/shuowu/pi-tree:latest
```

### 2. Configure your environment

```bash
cp .env.example .env
# Edit .env with your API key and provider
```

### 3. Run the container

```bash
docker run -d --name pi-tree \
  --env-file .env \
  -p 3847:3847 \
  -v pi-tree-data:/data \
  ghcr.io/shuowu/pi-tree:latest
```

Open **http://localhost:3847** — Docker serves both the frontend and API on a single port.

:::info
The Docker container runs on port **3847** by default, while local dev uses **3947**. This lets you run both side by side without conflicts.
:::

### Build from source (optional)

If you prefer to build the Docker image yourself:

```bash
cp .env.example .env   # edit with your API key and ABSOLUTE paths
docker compose up --build
```

:::tip
Advanced Docker Compose examples (custom skills, MCP servers, local LLMs, multi-provider) → [Docker Deployment](/docs/docker)
:::

## Option 3: From Source

Best if you want to explore the codebase, contribute, or customize deeply.

### Prerequisites

- [Node.js](https://nodejs.org/) **22+** and npm
- An API key from an LLM provider — or [Ollama](https://ollama.com/download) for local models

### 1. Clone the repository

```bash
git clone https://github.com/shuowu/pi-tree.git
cd pi-tree
```

### 2. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and set your LLM provider and API key:

```bash
PI_PROVIDER=deepseek          # or google, anthropic, openai, zhipu
PI_API_KEY=your-api-key-here
PI_MODEL=deepseek-v4-flash    # see Models & Providers for options
```

### 3. Install and run

```bash
npm install
npm run dev
```

This starts both the backend and frontend dev servers:

| Service | URL |
|---------|-----|
| Client (frontend) | [http://localhost:5947](http://localhost:5947) |
| Server (API) | [http://localhost:3947](http://localhost:3947) |

Open **http://localhost:5947** in your browser and you're ready to go!

:::tip
The dev server supports hot reload — changes to the source code will be reflected automatically.
:::

## What You'll See

Once you're running, here's what to expect:

**The Library** — your collection of books, news feeds, and other sources:

<img src="/images/library.png" alt="Library page showing book covers in a grid" style="border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 100%;" />

**A Reading Session** — tree sidebar, AI conversation, and branch cards:

<img src="/images/news-session.png" alt="News session with tree sidebar, AI summary, and branch cards" style="border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 100%;" />

## What's Next?

- **[Models & Providers](/docs/models)** — Configure cloud APIs, local models, or multi-provider setups
- **[Docker Deployment](/docs/docker)** — Advanced Docker Compose configurations, custom skills, and local LLMs
- **[Self-Hosting](/docs/self-hosting)** — Full guide to env vars, data layout, custom skills, extensions, and MCP integration
- **[Plugin Guide](/docs/examples)** — Custom skills, session profiles, and full plugin development
