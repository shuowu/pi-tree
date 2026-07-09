---
name: news-reading
description: AI-assisted news reading and trend analysis using tree-structured conversations. Handles daily briefings, category filtering, keyword searches, article reading, and report saving.
---

# News Reading & Trend Analysis

AI-assisted news aggregation, trend analysis, and story deep-dives using tree-structured conversations.

## IMPORTANT: Always Use Tools

**You MUST use the RSS tools below to fetch and analyze news data.** Do NOT browse the filesystem to check for articles or RSS configuration. The tools handle all RSS data access.

## Core RSS Tools

You have access to these native news tools:
- `get_rss_feeds_status()` — Check feed configurations and last fetch status.
- `get_feed_tags()` — List all available feed tags with associated feeds. Use this to understand what topic categories exist.
- `get_latest_rss(feeds, tags, days, limit, since_last_read)` — Retrieve chronological RSS items. Supports filtering by feed IDs OR tags.
- `search_rss(keyword, feeds, tags, days, limit, since_last_read)` — Substring search feed titles and summaries. Supports tag filtering.
- `aggregate_rss(feeds, tags, days, similarity_threshold, limit, since_last_read)` — Group and deduplicate stories across feeds. Supports tag filtering.
- `read_article(url)` — Fetch clean Markdown content from an article URL.
- `save_news_analysis(title, content, type)` — Save the markdown report to the local filesystem.
- `mark_feeds_read(feeds?, tags?)` — Update read watermarks after presenting a briefing. Prevents overlap in future sessions.

---

## Tag-Based Filtering

Feeds are organized by tags (e.g., `tech`, `ai`, `crypto`, `papers`). Use tags to scope your queries to relevant feeds.

**When the user asks about a specific topic** (e.g., "AI news", "crypto updates", "tech trends"):
1. Call `get_feed_tags()` to see available tags and which feeds they cover
2. Match the user's intent to relevant tags
3. Use the `tags` parameter: `aggregate_rss(tags=["ai"])`, `get_latest_rss(tags=["crypto"])`
4. If no matching tags exist, fall back to keyword search: `search_rss(keyword="bitcoin")`

**When the user doesn't specify a topic**, use all feeds (omit the `tags` parameter).

**When the user names specific feeds**, use the `feeds` parameter with feed IDs instead of tags.

---

## Session Focus

The first user message may be a **focus directive** set by the session router (e.g. "Focus on Hacker News feed" or "Focus on feeds tagged 'ai'"). When you receive one:

1. Call `get_feed_tags()` to resolve the feed name or tag to concrete feed IDs
2. **Scope ALL subsequent tool calls** (`aggregate_rss`, `get_latest_rss`, `search_rss`) to use the matching `feeds` or `tags` parameter
3. Mention the focus scope in your briefing header (e.g. *"Scanning Hacker News feed — 23 stories from the last 3 days."*)
4. If the focus doesn't match any configured feed or tag, tell the user and fall back to a keyword search

If the first message is a generic request (not a focus directive), use all feeds as normal.

---

## Read Watermarks (Avoiding Overlap)

The system tracks which articles you've already shown the user, per feed. To use this:

1. **Always pass `since_last_read=true`** in your initial data fetch — this filters out previously shown articles
2. **Call `mark_feeds_read()`** after presenting a briefing to advance the watermarks:
   - Unscoped session: `mark_feeds_read()` (marks all feeds)
   - Tag-scoped session: `mark_feeds_read(tags=["ai"])` (marks only matching feeds)
   - Feed-scoped session: `mark_feeds_read(feeds=["hackernews"])` (marks only that feed)
3. The `days` parameter still acts as a safety net — items older than N days are excluded even without a watermark
4. If the result set is empty (user is caught up), say so and offer to widen the window: "You're up to date! Want me to scan the last 7 days instead?"

**Do NOT call `mark_feeds_read` during deep dives or follow-up questions** — only after a broad-scan briefing (Mode A).

---

## Workflow

### Step 1: Fetch Feed Data When It's Needed

When the user wants feed content — a briefing, a scan, "what's new", or a specific story from the feeds — call the RSS tools right away; do NOT read the filesystem, and skip any freshness pre-check (feeds are kept fresh automatically).

**Do NOT reflexively pull the feed on every message.** When the user asks a conceptual, analytical, or follow-up question about something already on the table, answer *that question* — do not tack on a fresh `get_latest_rss` / `aggregate_rss` briefing (see Mode C).

### Step 2: Match Your Response to What Was Asked

Choose your response based on **what the message actually asks for — not where you are in the conversation tree.** Three shapes:
- A **generic** request ("what's new?") → a broad briefing (**Mode A**), even deep in a branch.
- A **specific story** request ("zoom in on X") → a targeted deep dive (**Mode B**), even as the first message.
- A **conceptual / analytical** question ("is this a broader trend?") → discuss and analyze (**Mode C**) — no briefing.

When the intent is ambiguous, default to the broad scan and invite the user to pick an angle to dive into.

#### Mode A: Broad Scan (The Briefing)
Use this when the message is generic, open-ended, or empty — e.g. "what's new?", "catch me up", "any updates?", "give me an overview", or a session that opens with no specific angle:
1. Call `aggregate_rss(since_last_read=true, days=3, similarity_threshold=0.80, limit=50)` to scan and group stories across feeds.
   - If the user specified a topic, add the matching `tags` parameter.
2. Categorize the grouped stories into sections derived from the feed tags and story content.
   Use `get_feed_tags()` output to inform section names — create topic sections that match the actual data.
   - Always lead with **Breaking / Major** for stories covered by 3+ sources.
   - Then create topic-specific sections based on the tags and themes present in the aggregated results.
   - Do NOT use hardcoded category names — adapt to whatever feeds are configured.
3. Present a concise briefing (1-2 sentences per story) showing source counts, and invite the user to pick an angle to dive into.
4. **Cite your data context** at the top of the briefing — mention which feeds/tags you scanned, how many items you processed, and the time range. Example opening:
   > *Scanned 14 feeds (tech, ai, finance) — 47 stories from the last 3 days, grouped into 12 topics.*

**Citation format**: For every story, include inline source links using markdown. The `sources` array from `aggregate_rss` contains `url` and `feedName` for each article. Format citations like:

- **Story headline** — 1-2 sentence summary. *[Source1](url1), [Source2](url2)*

For single-source stories: *[TechCrunch](https://techcrunch.com/...)*
For multi-source stories: *[Hacker News](https://...), [TechCrunch](https://...)*

#### Mode B: Deep Dive (Targeted)
Use this when the message names a specific story, topic, feed, or article, or asks to go deeper — regardless of whether it's the first message of the session or a later follow-up:
1. Run targeted searches: `search_rss(keyword=...)` with specific keywords.
2. If the user points to a specific URL or article, call `read_article(url=...)` to retrieve the full-text content.
3. Synthesize the findings:
   - What the story is about.
   - Key drivers and timeline.
   - Sentiment snapshot (overall tone in the community/outlets).
   - Practical or investment implications.
4. Present the analysis and answer any follow-up questions.

#### Mode C: Discuss & Analyze (No Briefing)
Use this when the message is an open-ended, conceptual, or analytical question — e.g. "why is this happening?", "is this a broader trend?", "how does X work?", or any follow-up that builds on what's already been discussed:
1. Answer the question directly, reasoning from the conversation so far.
2. Use web search — or `search_rss`/`read_article` for a specific story — only to gather supporting evidence for *that* question.
3. **Do NOT call `get_latest_rss` / `aggregate_rss` or append a feed briefing.** The user is thinking through an idea, not asking for more headlines. Only pull the feed if they explicitly ask for more items or a new scan.

**Rule of thumb:** answer only what was asked. Never append a "here's the latest from …" briefing to a Mode B or Mode C reply.

### Step 2.5: Mark Feeds as Read

After presenting a broad-scan briefing (Mode A), call `mark_feeds_read()` scoped to the same feeds/tags used in your query. This prevents overlap in future sessions. Skip this for deep dives (Mode B).

### Step 3: Save Analyses — ONLY on User Request

**NEVER call `save_news_analysis` unless the user explicitly asks** (e.g., "save this", "write it up", "save the briefing"). Do NOT proactively save briefings, summaries, or analyses — the user decides what's worth keeping.

When the user requests a save:
1. Call `save_news_analysis` with:
   - `title`: A slug-friendly title (e.g., "OpenAI Search Launch").
   - `content`: The complete synthesized Markdown report.
   - `type`: Use "summaries" for broad-scan briefings, and "analyses" for deep dives.
2. Confirm the saved file path to the user.
