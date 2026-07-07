---
layout: home

hero:
  name: Pi-tree
  text: AI that reads with you
  tagline: "Load books, research papers, news feeds, and YouTube videos — then explore them in branching, tree-structured AI conversations. Local-first, open source, bring your own key."
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
  - icon: ✨
    title: Discover
    details: Ask "what should I read next?" — recommendations for new books, papers, and feeds grounded in your actual reading history, each with a reason tied to what you read. One click adds them to your library.
    linkText: See it in action →
    link: /docs/features#discover
  - icon: 🧠
    title: Memos & Concepts
    details: Save takeaways as searchable memos, and let pi-tree extract concepts from every source into a cross-source knowledge graph — ideas link up across books, papers, and videos.
  - icon: 🏠
    title: Local-First
    details: Everything runs on your machine — desktop app, Docker, or from source. No cloud account, no subscription. Works with cloud APIs or fully offline with Ollama / local models.
  - icon: 🔌
    title: Plugins & MCP
    details: "Three levels of customization: drop in a skill file, add a YAML profile for a new source type, or build a full plugin. Connect external MCP servers with no code changes."
    linkText: Plugin guide →
    link: /docs/examples
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

**AI makes you productive where you already understand. It confuses you where you don't.** Most AI tools help you skip past material — paste, summarize, move on. That works when you already understand the domain; when you don't, skipping is exactly the problem. Pi-tree treats reading as a process worth having — one that expands what you're capable of understanding.

<div class="comparison-table-wrapper">

| | Pi-tree | ChatGPT / Claude | NotebookLM | Obsidian + AI |
|---|---|---|---|---|
| **Focus** | Comprehension & exploration | General-purpose Q&A | Document Q&A | Note-taking |
| **Conversations** | 🌳 Tree — branch, explore, return | Linear chat | Linear chat | Linear chat |
| **AI approach** | Agentic — tools & skills over local data | Prompt + context window | RAG over uploads | Plugins over local vault |
| **Sources** | Books, papers, news feeds, YouTube | File uploads, web | Multi-doc notebooks | Markdown vault |
| **Extensibility** | Skills, plugins, MCP bridge | GPTs (cloud-hosted) | None | Community plugins |
| **Model choice** | BYOK — any provider or local | Vendor-locked | Google only | Plugin-dependent |
| **Data** | Local-first, self-hosted | Cloud | Cloud | Local |

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

- 🛡️ **Session-scoped permissions** — Each session type declares in YAML exactly which tools the agent can use. A book reading session gets 5-8 purpose-built tools. No shell. No file editing. No database writes. Audit the profiles, override them, create your own.
- 📡 **Fully offline** — pair with [Ollama](https://ollama.com) for air-gapped operation. No internet required.
- 📖 **Open source** — AGPL-3.0. Audit the code, fork it, self-host it.

Pi-tree's agent is a **reading companion**, not a general-purpose agent. The permission model reflects that.

[Learn more about the vision →](/vision)

</div>
