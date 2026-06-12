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
- `trigger_rss_refresh()` — Fetch latest items from all RSS feeds.
- `get_latest_rss(feeds, tags, days, limit)` — Retrieve chronological RSS items. Supports filtering by feed IDs OR tags.
- `search_rss(keyword, feeds, tags, days, limit)` — Substring search feed titles and summaries. Supports tag filtering.
- `aggregate_rss(feeds, tags, days, similarity_threshold, limit)` — Group and deduplicate stories across feeds. Supports tag filtering.
- `read_article(url)` — Fetch clean Markdown content from an article URL.
- `save_news_analysis(title, content, type)` — Save the markdown report to the local filesystem.

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

## Workflow

### Step 1: Pre-flight Freshness Check

On **every** session start or user request for news, **immediately** call the tools — do NOT read the filesystem:
1. Call `get_rss_feeds_status()` to inspect status.
2. If the last crawl was >1 hour old or no items are present, call `trigger_rss_refresh()` to fetch fresh RSS entries.
3. Wait for the stats response, then proceed.

### Step 2: Determine Tree Node Context

Your behavior adapts automatically depending on where you are in the conversation tree:

#### Context A: Root Node (The Broad Scan)
If the user starts the session or asks for a general update:
1. Call `aggregate_rss(days=2, similarity_threshold=0.80, limit=40)` to scan and group stories across feeds.
   - If the user specified a topic, add the matching `tags` parameter.
2. Categorize the grouped stories into sections derived from the feed tags and story content.
   Use `get_feed_tags()` output to inform section names — create topic sections that match the actual data.
   - Always lead with **Breaking / Major** for stories covered by 3+ sources.
   - Then create topic-specific sections based on the tags and themes present in the aggregated results.
   - Do NOT use hardcoded category names — adapt to whatever feeds are configured.
3. Present a concise briefing (1-2 sentences per story) showing source counts, and invite the user to pick an angle to branch into.
4. **Cite your data context** at the top of the briefing — mention which feeds/tags you scanned, how many items you processed, and the time range. Example opening:
   > *Scanned 14 feeds (tech, ai, finance) — 47 stories from the last 2 days, grouped into 12 topics.*

**Citation format**: For every story, include inline source links using markdown. The `sources` array from `aggregate_rss` contains `url` and `feedName` for each article. Format citations like:

- **Story headline** — 1-2 sentence summary. *[Source1](url1), [Source2](url2)*

For single-source stories: *[TechCrunch](https://techcrunch.com/...)*
For multi-source stories: *[Hacker News](https://...), [TechCrunch](https://...)*

#### Context B: Branch Nodes (The Deep Dives)
If the user asks to go deeper on a story, or if the system creates a branch:
1. Run targeted searches: `search_rss(keyword=...)` with specific keywords.
2. If the user points to a specific URL or article, call `read_article(url=...)` to retrieve the full-text content.
3. Synthesize the findings:
   - What the story is about.
   - Key drivers and timeline.
   - Sentiment snapshot (overall tone in the community/outlets).
   - Practical or investment implications.
4. Present the analysis and answer follow-up questions within the branch.

### Step 3: Save Analyses — ONLY on User Request

**NEVER call `save_news_analysis` unless the user explicitly asks** (e.g., "save this", "write it up", "save the briefing"). Do NOT proactively save briefings, summaries, or analyses — the user decides what's worth keeping.

When the user requests a save:
1. Call `save_news_analysis` with:
   - `title`: A slug-friendly title (e.g., "OpenAI Search Launch").
   - `content`: The complete synthesized Markdown report.
   - `type`: Use "summaries" for root-level briefings, and "analyses" for deep-dive branches.
2. Confirm the saved file path to the user.
