---
title: Getting Started
description: Set up pi-tree locally or with Docker in just a few minutes.
---

# Getting Started

Pi-tree is designed to be easy to set up. You can run it locally for development or use Docker for a quick, self-contained deployment. This guide covers both paths.

## Prerequisites

- [Node.js](https://nodejs.org/) **22+** and npm (for local development)
- [Docker](https://docs.docker.com/get-docker/) (for containerized deployment)

You'll also need an API key from an LLM provider — or a local model server like [Ollama](https://ollama.com/download). See [Models & Providers](/docs/models) for options.

## Option 1: Local Development

The fastest way to get started if you want to explore the codebase or contribute.

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

## Option 2: Docker Quick Start

Docker is the simplest path for running pi-tree as a self-hosted service. Pre-built images are published to GitHub Container Registry on every release, supporting both `linux/amd64` and `linux/arm64`.

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

## What's Next?

- **[Models & Providers](/docs/models)** — Configure cloud APIs, local models, or multi-provider setups
- **[Docker Deployment](/docs/docker)** — Advanced Docker Compose configurations, custom skills, and local LLMs
