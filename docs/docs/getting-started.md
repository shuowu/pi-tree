---
title: Getting Started
description: Set up pi-tree in minutes — Docker (recommended) or from source.
---

# Getting Started

Pick a setup method and you'll be reading in minutes. Whichever you choose, pi-tree needs an AI model to read with you — a cloud API key or a local model.

::: details Don't have an API key? It takes about two minutes
Pi-tree works great with cheap, fast models — no expensive frontier model required.

1. Create a free account with [DeepSeek](https://platform.deepseek.com/) or [Google AI Studio](https://aistudio.google.com/) (Gemini has a free tier)
2. Generate an API key from the dashboard
3. Paste it into your `.env` file (or the desktop app's Settings page)

Reading an entire book typically costs a few cents with DeepSeek — or nothing at all with a free local model via [Ollama](https://ollama.com/download). See [Models & Providers](/docs/models) for recommendations.
:::

:::tabs
== Docker (Recommended)

Docker is the easiest way to run pi-tree — no Node.js, no build tools.

### Prerequisites

- [Docker](https://docs.docker.com/get-started/get-docker/) installed
- An API key from an LLM provider — or [Ollama](https://ollama.com/download) for local models

### 1. Pull the image

```bash
docker pull ghcr.io/shuowu/pi-tree:latest
```

### 2. Create your `.env` file

Create a `.env` file with your provider and API key:

```bash
PI_PROVIDER=deepseek
PI_API_KEY=your-api-key-here
PI_MODEL=deepseek-v4-flash
```

See [Models & Providers](/docs/models) for other providers and local model setup.

### 3. Run the container

```bash
docker run -d --name pi-tree \
  --env-file .env \
  -p 3847:3847 \
  -v ~/.local/share/pi-tree:/data \
  ghcr.io/shuowu/pi-tree:latest
```

### 4. Verify

Open **http://localhost:3847** — Docker serves both the frontend and API on a single port. You should see the Library page.

Check the logs if something looks wrong:

```bash
docker logs pi-tree
```

### Configuration

**Port:** `3847` by default. Change with `-p <port>:3847` or set `PORT` in `.env`.

**Data:** All state (database, sessions, library, custom skills) is stored in `/data` inside the container. The `-v ~/.local/share/pi-tree:/data` flag maps it to a directory on your host machine, so data persists across container upgrades and restarts.

**Environment variables:**

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `PI_PROVIDER` | **Yes** | — | `deepseek`, `google`, `anthropic`, `openai`, `zhipu` |
| `PI_API_KEY` | **Yes** | — | API key for your provider |
| `PI_MODEL` | **Yes** | — | Model ID (e.g., `deepseek-v4-flash`) |
| `PI_BASE_URL` | No | Provider default | Custom base URL (proxies, local models) |
| `PI_LOOKUP_MODEL` | No | Same as `PI_MODEL` | Cheaper model for dictionary lookups |
| `PORT` | No | `3847` | Server port |

> **💡 Using a local model (Ollama / LM Studio)?** Docker containers can't reach `localhost` on your host machine. See [Self-Hosting — Local LLM](/docs/self-hosting#docker-local-llm) for the networking setup.

For the full env var list, see [Self-Hosting — Environment Variables](/docs/self-hosting#environment-variables)

#### Build from source (optional)

If you prefer to build the Docker image yourself, clone the repo and run:

```bash
git clone https://github.com/shuowu/pi-tree.git
cd pi-tree
cp .env.example .env   # edit with your API key
docker compose up --build
```

Advanced Docker Compose examples (custom skills, MCP servers, local LLMs, multi-provider) → [Self-Hosting — Docker Compose](/docs/self-hosting#docker)

== From Source

Best if you want to explore the codebase, contribute, or customize deeply.

### Prerequisites

- [Node.js](https://nodejs.org/) **22+** (we develop on Node 24)
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

### 4. Verify

Open **http://localhost:5947** in your browser. You should see the Library page. In the terminal, look for:

```
Server listening on http://localhost:3947
```

### Configuration

**Ports:** Dev server on `3947`, client on `5947` (different from Docker's `3847` — both can run side by side).

**Data:** All state lives under `DATA_PATH`, which defaults to `~/.local/share/pi-tree`. Override it in `.env` to change the location.

> **💡 Dev data isolation:** If you have [direnv](https://direnv.net/docs/installation.html) installed, run `direnv allow` — it sets `DATA_PATH` to a project-local `.local-data/` directory, isolating dev data from Docker.

**Environment variables:**

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `PI_PROVIDER` | **Yes** | — | `deepseek`, `google`, `anthropic`, `openai`, `zhipu` |
| `PI_API_KEY` | **Yes** | — | API key for your provider |
| `PI_MODEL` | **Yes** | — | Model ID (e.g., `deepseek-v4-flash`) |
| `PI_BASE_URL` | No | Provider default | Custom base URL (proxies, local models) |
| `PI_LOOKUP_MODEL` | No | Same as `PI_MODEL` | Cheaper model for dictionary lookups |
| `DATA_PATH` | No | `~/.local/share/pi-tree` | Root directory for all state |
| `PORT` | No | `3947` (via direnv) | Server port |

For the full env var list, see [Self-Hosting — Environment Variables](/docs/self-hosting#environment-variables).

> **💡 Tip:** The dev server supports hot reload — changes to the source code will be reflected automatically.

== Desktop App

> **⚠️ Experimental:** The desktop app is in early testing. If you run into issues, try Docker or From Source instead.

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

### 3. Verify

You should see the Library page — an empty grid ready for your first source. If the app shows a settings/configuration screen instead, your model provider isn't configured yet.

### Configuration

**No `.env` file needed** — the desktop app is configured entirely through the in-app **Settings** page (model, provider, API key, base URL).

**Data:** All state is stored locally in a platform-specific directory:

- **macOS**: `~/Library/Application Support/pi-tree`
- **Linux**: `~/.local/share/pi-tree`
- **Windows**: `%APPDATA%/pi-tree`

:::

## First Launch

Once pi-tree is running (any setup option), the first-time experience is the same:

**1. Create your identity** — On your first visit, you'll see a user picker. Enter a username and display name. This is stored locally — no account or sign-up needed.

**2. Add a source** — Click **Add Source** in the Library. You'll see tabs for each supported content type — upload a file, paste a URL, or add a feed. Pick whichever you'd like to try first.

**3. Start a conversation** — Open your source and start chatting. The AI reads the content with you, branching the conversation into a navigable tree as you explore different topics.

:::tip
See [Features](/docs/features) for a visual tour of all supported source types and what each session looks like.
:::

:::tip Changing models later
You can switch the model, provider, or API key at any time through the **Settings** page — no restart needed. For multi-provider setups (e.g., Ollama + DeepSeek), see [Self-Hosting — Multi-Provider](/docs/self-hosting#multi-provider-models-models-json).
:::

## What You'll See

**The Library** — your collection of sources:

<img src="/images/library.png" alt="Library page showing book covers in a grid" style="border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 100%;" />

**A Reading Session** — tree sidebar, AI conversation, and branch cards:

<img src="/images/news-session.png" alt="News session with tree sidebar, AI summary, and branch cards" style="border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); max-width: 100%;" />

## What's Next?

- **[Features](/docs/features)** — Visual tour of all source types and capabilities
- **[Models & Providers](/docs/models)** — Configure cloud APIs, local models, or multi-provider setups
- **[Self-Hosting](/docs/self-hosting)** — Docker Compose, env vars, data layout, custom skills, extensions, and MCP integration
- **[Plugin Guide](/docs/examples)** — Custom skills, session profiles, and full plugin development
