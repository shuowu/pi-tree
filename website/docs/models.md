---
title: Models & Providers
description: Configure LLM providers for pi-tree — cloud APIs, local models with Ollama or LM Studio, and multi-provider setups.
---

# Models & Providers

Pi-tree works with a wide range of LLM providers and models. It doesn't need frontier-class models — reading and comprehension are more about context and conversation than raw reasoning. Smaller, faster models work well and keep costs low (or free with local inference).

## Cloud APIs

The cheapest options that work well for reading:

| Provider | Model | Notes |
|----------|-------|-------|
| DeepSeek | `deepseek-v4-flash` | Very cheap, strong reading comprehension |
| Google | `gemini-2.5-flash` | Fast, large context window |
| Anthropic | `claude-haiku-4-20250514` | Fast, great quality-to-cost ratio |
| Zhipu | `glm-5-turbo` | Good Chinese + English bilingual support |

To use a cloud provider, set these variables in your `.env` file:

```bash
PI_PROVIDER=deepseek
PI_API_KEY=your-api-key-here
PI_MODEL=deepseek-v4-flash
```

:::tip
You can also set `PI_LOOKUP_MODEL` to a cheaper or faster model for dictionary lookups, keeping the primary model for reading sessions.
:::

## Local Models

Run models completely offline with no API costs using [Ollama](https://ollama.com/download) or [LM Studio](https://lmstudio.ai/). Gemma 4 (12B, 256K context) and Qwen 3.6 are good starting points — explore what works for your hardware and reading language.

### Setup with Ollama

1. [Install Ollama](https://ollama.com/download) and pull a model:

```bash
ollama pull gemma4:12b
```

2. Point pi-tree at your local server in `.env`:

```bash
PI_PROVIDER=openai                              # Ollama exposes an OpenAI-compatible API
PI_API_KEY=not-needed
PI_BASE_URL=http://localhost:11434/v1            # Ollama default
PI_MODEL=gemma4:12b
```

### Setup with LM Studio

1. [Install LM Studio](https://lmstudio.ai/) and download a model
2. Start the local server in LM Studio
3. Configure `.env`:

```bash
PI_PROVIDER=openai
PI_API_KEY=not-needed
PI_BASE_URL=http://localhost:1234/v1             # LM Studio default
PI_MODEL=your-model-name
```

:::warning Docker users
When running pi-tree in Docker, two extra steps are needed:

1. **Bind to all interfaces** — LM Studio defaults to `127.0.0.1` (localhost only). Docker containers can't reach it. Run `lms server start --bind 0.0.0.0` or set `"networkInterface": "0.0.0.0"` in `~/.lmstudio/.internal/http-server-config.json`.

2. **Use `host.docker.internal`** — Replace `localhost` with `host.docker.internal` in your base URL. On Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to your Compose file.

See [Docker Deployment — Local LLM](/docs/docker#using-a-local-llm) for a complete walkthrough.
:::

### Compatibility flags

When using `models.json` with local providers, add `compat` flags to avoid silent failures:

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "compat": { "supportsDeveloperRole": false },
      "models": [
        { "id": "qwen/qwen3.6-27b" }
      ]
    }
  }
}
```

Most local servers (LM Studio, Ollama, llama.cpp) only support `system` and `user` message roles. Setting `"supportsDeveloperRole": false` prevents the AI framework from sending unsupported `developer` role messages, which would cause empty responses.

## Multi-Provider Setup

For advanced setups — like using Ollama for offline reading and DeepSeek for cloud — use Pi's native `models.json` configuration. This lets you define multiple providers and switch between them at runtime.

### Configure `models.json`

Place the file at `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "gemma4:12b" },
        { "id": "qwen3.6:8b" }
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

### How resolution works

Environment variables and `models.json` merge automatically:

- If you set `PI_PROVIDER` + `PI_API_KEY` in `.env` **and** have providers in `models.json`, all providers are available
- The env var provider's API key takes precedence over `models.json` for that specific provider
- You can use both approaches together — they complement each other

### Docker with `models.json`

Mount the file into the container:

```yaml
volumes:
  - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
```

## Runtime Model Switching

:::tip
You can change models at runtime through the **Settings UI** — no restart needed. This is especially useful with multi-provider setups: switch between a local model for casual reading and a cloud model for complex analysis on the fly.
:::

## What's Next?

- **[Getting Started](/docs/getting-started)** — Set up pi-tree for the first time
- **[Docker Deployment](/docs/docker)** — Deploy with Docker Compose, custom skills, and more
