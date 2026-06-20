---
layout: home

hero:
  name: Pi-tree
  text: AI-assisted reading with tree-structured conversations
  tagline: "AI made everyone a faster producer. Nobody's becoming a better reader. Pi-tree is for the input side — helping you understand things deeper, not produce things faster."
  actions:
    - theme: brand
      text: Download Desktop App
      link: https://github.com/shuowu/pi-tree/releases/latest
    - theme: alt
      text: Get Started
      link: /docs/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/shuowu/pi-tree

features:
  - icon: 🌳
    title: Tree-Structured Conversations
    details: Branches happen on semantic shifts — go deeper, follow tangents, zoom back out. Your reading path is a navigable tree, not a disposable chat log.
  - icon: 📚
    title: Multi-Source
    details: Books (EPUB, MOBI, PDF), news feeds (RSS/Atom), research papers — all stored as sources with AI-powered conversational exploration.
  - icon: 🏠
    title: Local-First
    details: Everything runs on your machine. No cloud account, no subscription. Works with cloud APIs or fully offline with Ollama / local models.
  - icon: 🖥️
    title: Desktop App
    details: Download and run — no Node.js, no Docker, no terminal. Available for macOS, Linux, and Windows.
  - icon: 🧩
    title: Extensible Skills
    details: Behavior is shaped by markdown skill files, not hardcoded logic. Change a SKILL.md, change how the AI reads. Add custom skills without touching code.
  - icon: 🔌
    title: MCP Bridge
    details: Connect external MCP servers for web search, academic databases, or any MCP-compatible tool — no code changes needed.
---

<div class="demo-showcase">
  <figure>
    <video autoplay loop muted playsinline>
      <source src="/images/demo.webm" type="video/webm" />
      <source src="/images/demo.mp4" type="video/mp4" />
    </video>
    <figcaption>News session — AI summary, branching into topics, tree navigation, streaming response</figcaption>
  </figure>
</div>

<div class="comparison-section">

## Why Pi-tree?

Most AI tools treat reading as a problem to skip past. Pi-tree treats it as a process worth having.

<div class="comparison-table-wrapper">

| | Pi-tree | ChatGPT / Claude | NotebookLM | Obsidian + AI |
|---|---|---|---|---|
| **Focus** | Comprehension & exploration | General-purpose Q&A | Document Q&A | Note-taking |
| **Conversations** | 🌳 Tree — branch, explore, return | Linear chat | Linear chat | Linear chat |
| **Persistence** | Long-term reading companion | Session-oriented | Project-scoped | Manual |
| **Model choice** | BYOK — any provider or local | Vendor-locked | Google only | Plugin-dependent |
| **Data** | Local-first, your machine | Cloud | Cloud | Local |

</div>

### What a reading session looks like

```
📖 Reading: Thinking, Fast and Slow (Kahneman)

Root
├── What is System 1 vs System 2?
│   ├── How does this relate to cognitive biases?
│   │   └── Anchoring bias deep-dive
│   └── Real-world examples in decision making
├── Chapter 3: The Lazy Controller
│   └── Why do we avoid effortful thinking?
└── Comparison with Nassim Taleb's ideas
    ├── Black Swan connection
    └── Antifragility and heuristics
```

Each node is a conversation branch with full context. Go deep on any concept, then navigate back to explore something else — no context lost.

</div>

<div class="comparison-section">

### Why trees work better for LLMs

The tree structure isn't just a UX choice — it makes the AI more accurate and cheaper to run.

In a linear chat, every message is packed into the context window. After 30 turns spanning three topics, the model hallucinates, loses the thread, or ignores your latest question. Trees fix this at the architecture level:

- **Focused context** — Each branch carries only its path from root to current node. Less noise → more accurate responses.
- **Token savings** — A 50-message linear chat sends all 50 every turn. A tree with 5 branches of 10 sends only ~10. Lower cost, faster responses.
- **Less hallucination** — Context pollution is a primary cause of hallucination in long conversations. Isolated branches keep the model grounded.
- **Longer effective conversations** — Linear chats degrade well before the context limit. Trees keep each branch short, so quality stays high across hundreds of messages.

</div>

<div class="audience-section">

## Who Is This For?

<div class="audience-grid">

- 📚 **Serious nonfiction readers** — turn passive reading into active conversation
- 🎓 **Researchers & graduate students** — work through papers with persistent context
- 📰 **News followers** — RSS feeds become conversational sources, not scroll fodder
- 🧠 **PKM enthusiasts** — tree-structured conversations as a knowledge building primitive
- 🔧 **Developers** — explore codebases conversationally with [custom extensions](/docs/examples)

</div>

</div>

<div class="security-section">

## Security & Privacy

Local-first — no cloud, no telemetry, no phone-home. But "local" isn't the interesting part.

Most AI agents get **broad access** — shell, filesystem, network — and rely on you to supervise. Pi-tree flips this: each session type declares exactly which tools the agent can use, and everything else is blocked.

- 🛡️ **Session-scoped permissions** — A book reading session gets a reading skill and nothing else. No shell. No file editing. No database writes. The agent's tool surface is 5-8 purpose-built tools, not hundreds.
- 🔧 **Two trust tiers** — Built-in extensions (library, RSS) are auditable code in the repo with scoped DB access. MCP tools are external, opt-in, namespace-prefixed, and have zero access to pi-tree internals.
- 📝 **Declarative profiles** — Capabilities are configured in YAML. Audit them, override them, create your own. `exclude_tools: [bash, edit]` is the default for all user-facing sessions.
- 📡 **Fully offline** — pair with [Ollama](https://ollama.com) for air-gapped operation. No internet required.
- 📖 **Open source** — AGPL-3.0. Audit the code, fork it, self-host it.

Pi-tree's agent is a **reading companion**, not a general-purpose agent. The permission model reflects that.

</div>

<div class="problem-section">

## The Problem

Every AI assistant can summarize a book or answer questions about an article. But they all treat understanding as a step to skip — paste text in, get the answer out, move on. There's no structure, no persistence, no sense of *journey* through the material.

<p class="lead">
Real comprehension isn't linear. You branch — <em>"wait, how does this connect to X?"</em> — then come back. You re-read something with new context. You accumulate a personal vocabulary of terms and ideas. Flat chat threads can't capture any of this.
</p>

**Pi-tree fixes this.** Each source gets a tree-structured conversation where branches happen on semantic shifts, you can zoom in and out freely, every user gets their own path, and everything stays local on your machine.

[Learn more about the vision →](/vision)

</div>
