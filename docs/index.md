---
layout: home

hero:
  name: Pi-tree
  text: AI that reads with you
  tagline: "AI makes you productive where you already understand. It confuses you where you don't. Pi-tree works on the boundary — helping you cross from confusion into comprehension, not skip past it."
  actions:
    - theme: brand
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
    details: Books (EPUB, MOBI, PDF), news feeds (RSS/Atom), research papers, YouTube videos — all stored as sources with AI-powered conversational exploration.
    linkText: See all source types →
    link: /docs/features
  - icon: 🏠
    title: Local-First
    details: Everything runs on your machine. No cloud account, no subscription. Works with cloud APIs or fully offline with Ollama / local models.
  - icon: 🖥️
    title: Desktop App
    details: Download and run — no Node.js, no Docker, no terminal. Available for macOS, Linux, and Windows.
  - icon: 🔌
    title: Plugin Architecture
    details: "Three levels of customization: drop in a skill file to change AI behavior, add a YAML profile to create a new source type, or build a full plugin with its own tools, routes, and UI."
    linkText: Plugin guide →
    link: /docs/examples
  - icon: 🧩
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

Most AI tools help you skip past material. That works when you already understand the domain. When you don't, skipping is exactly the problem. Pi-tree treats reading as a process worth having — one that expands what you're capable of understanding.

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

- 📚 **Nonfiction readers** — you're reading a dense chapter and AI summaries skip the part you actually don't understand. Pi-tree stays in that gap with you until you do.
- 🎓 **Researchers & students** — you're outside your subfield and every paper assumes background you lack. Branch into what you don't know, then return to the argument.
- 📰 **News followers** — you read the headline but can't evaluate the claim. Turn feeds into conversations where you build context over time, not scroll past it.
- 🔧 **Developers** — you're in an unfamiliar codebase or domain. Build [custom plugins](/docs/examples) to explore anything conversationally.

</div>

</div>

<div class="security-section">

## Security & Privacy

Local-first — no cloud, no telemetry, no phone-home. But "local" isn't the interesting part.

Most AI agents get **broad access** — shell, filesystem, network — and rely on you to supervise. Pi-tree flips this: each session type declares exactly which tools the agent can use, and everything else is blocked.

- 🛡️ **Session-scoped permissions** — Each session type declares exactly which tools the agent can use. A book reading session gets 5-8 purpose-built tools. No shell. No file editing. No database writes.
- 🔌 **Plugin isolation** — Each source type is an independent plugin with scoped access. Plugins can't reach server internals — services are injected at runtime.
- 📝 **Declarative profiles** — Capabilities are configured in YAML. Audit them, override them, create your own. `exclude_tools: [bash, edit]` is the default for all user-facing sessions.
- 📡 **Fully offline** — pair with [Ollama](https://ollama.com) for air-gapped operation. No internet required.
- 📖 **Open source** — AGPL-3.0. Audit the code, fork it, self-host it.

Pi-tree's agent is a **reading companion**, not a general-purpose agent. The permission model reflects that.

</div>

<div class="problem-section">

## The Problem

AI accelerates people inside their circle of competence and bewilders them outside it. Ask a domain expert a smart question and AI gives them a brilliant answer. Ask a beginner the same question and they get a confident-sounding paragraph they can't evaluate. Summaries, Q&A, "explain like I'm five" — they all assume you know enough to judge the output. When you don't, AI doesn't bridge the gap. It wallpapers over it.

<p class="lead">
Real comprehension isn't linear. You branch — <em>"wait, how does this connect to X?"</em> — then come back. You re-read something with new context. You accumulate a personal vocabulary of terms and ideas. You push your boundary outward, one concept at a time. Flat chat threads can't capture any of this.
</p>

**Pi-tree fixes this.** Each source gets a tree-structured conversation where branches happen on semantic shifts, you can zoom in and out freely, every user gets their own path, and everything stays local on your machine. The goal isn't to give you the answer faster — it's to expand the territory where you can evaluate answers for yourself.

[Learn more about the vision →](/vision)

</div>
