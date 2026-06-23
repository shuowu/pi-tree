---
outline: deep
---

# Features in Action

Pi-tree is built for comprehension, not productivity. Instead of a generic chatbot with documents bolted on, each source type gets purpose-built AI tools and skills — an agentic approach where the AI actively reads and explores with you. Here's what that looks like in practice.

## Library

Your personal reading library — all sources in one place. Filter by type, search across everything.

<div class="screenshot-frame">
  <img src="/images/screenshots/library.png" alt="Pi-tree library showing books, news feeds, YouTube videos, and papers organized in a grid" />
</div>

## Home — Chat Router

The home page is an AI-powered hub. Instead of clicking through menus, you just talk — *"what's in my library?"*, *"open The Coming Wave"*, *"catch me up on AI news"* — and the router navigates you there. It has access to all plugin tools and can list sources, create sessions, or open existing ones directly from the conversation.

<div class="screenshot-frame">
  <img src="/images/router-demo.gif" alt="Chat router demo — user asks about library, AI lists books, user says 'open The Coming Wave', AI navigates to reader session" />
</div>

**The flow:**
1. Ask anything — *"what's in my library?"*, *"open The Coming Wave"*, *"find papers on attention mechanisms"*
2. The router figures out the intent — it can list sources, open an existing session, or create a new one
3. You're navigated directly into the reader with full context

You don't need to browse first. If you already know what you want, just say it — *"continue reading Principles"* or *"check today's news"* — and the router takes you there directly.

The **Continue** section below the chat shows recent sessions across all source types for quick resume.

## Book Reading

Upload EPUB, MOBI, or PDF files. The AI guides you through the book with contextual reading skills. The right panel shows the **table of contents** — click any chapter to jump there in conversation.

<div class="screenshot-frame">
  <img src="/images/screenshots/book-session.png" alt="Book reading session showing Principles by Ray Dalio with tree sidebar, AI analysis, and chapter navigation" />
</div>

**What you see:**
- **Left** — Session tree showing conversation branches
- **Center** — AI-generated overview of key principles with structured formatting
- **Right** — Full book table of contents for navigating chapters

## News Feeds

Add RSS/Atom feeds organized by topic. The AI scans and synthesizes stories across feeds. The right panel shows your **feed dashboard** — all subscribed feeds grouped by tag.

<div class="screenshot-frame">
  <img src="/images/screenshots/news-session.png" alt="News session showing AI-curated tech headlines from TechCrunch, The Decoder, and others with feed management panel" />
</div>

**What you see:**
- **Center** — AI-curated digest with headlines, summaries, and source attribution
- **Right** — 11 RSS feeds organized by category (#ai, #tech, #finance, #world)

## YouTube Videos

Paste a YouTube link. Pi-tree extracts the transcript and metadata, then lets you discuss the content with AI. The right panel shows the **embedded video player** with a timestamped, scrollable transcript.

<div class="screenshot-frame">
  <img src="/images/screenshots/youtube-session.png" alt="YouTube session analyzing a ThePrimeTime video about Meta, with embedded video player and timestamped transcript" />
</div>

**What you see:**
- **Center** — Structured summary with sections (The Applied AI Unit, Employee Morale, Management Response)
- **Right** — Embedded YouTube player + full timestamped transcript you can click to jump to specific moments

## Research Papers

Search arXiv directly from the chat. The AI fetches paper metadata, reads the full text, and helps you work through methodology, results, and related work.

<div class="screenshot-frame">
  <img src="/images/screenshots/paper-session.png" alt="Paper reading session showing Attention Is All You Need with arXiv metadata and architecture overview" />
</div>

**What you see:**
- Full arXiv metadata (authors, publication date, categories)
- Structured summary of the Transformer architecture with technical details

## The Three-Panel Layout

Every session follows the same pattern:

```
┌──────────────┬─────────────────────────────┬──────────────────┐
│  Session     │                             │  Plugin Panel    │
│  Tree        │      Chat / AI Response     │  (source-type    │
│              │                             │   specific)      │
│  • branch 1  │  User: "explain this..."    │  📖 Book TOC     │
│    • sub     │                             │  📰 Feed list    │
│  • branch 2  │  AI: structured response    │  🎥 Video player │
│    • sub     │      with formatting        │  📄 Paper refs   │
│              │                             │                  │
└──────────────┴─────────────────────────────┴──────────────────┘
```

The **left panel** (Session Tree) and **center** (Chat) are provided by `@pi-tree/ui`. The **right panel** is injected by each plugin — this is how plugins extend the UI without touching core code.

## Plugin-Driven Design

Each source type is a self-contained plugin that provides:

| Capability | Book | News | YouTube | Paper |
|---|---|---|---|---|
| **AI Tools** | `process_book` | `get_latest_rss`, `search_rss` | `get_youtube_info`, `get_youtube_transcript` | `search_papers`, `get_paper_info`, `read_paper` |
| **Skills** | interactive-reading, analysis, outline | news-reading | youtube-watching | paper-reading |
| **Right Panel** | Table of Contents | Feed Dashboard | Video Player + Transcript | — |
| **Own Database** | — | ✅ (feeds, articles) | — | — |
| **HTTP Routes** | — | `/api/news/*` | — | — |

Plugins depend only on `@pi-tree/plugin-sdk` and declare everything in their `package.json` manifest. The server discovers and wires them automatically at startup.

<style>
.screenshot-frame {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  margin: 1.5rem 0 2rem;
}

.screenshot-frame img {
  display: block;
  width: 100%;
  height: auto;
}
</style>
