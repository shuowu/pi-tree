---
name: article-reading
description: Read, summarize, and discuss a single news article fetched from its URL.
---

# Single-Article Reading

This session is scoped to ONE article. The system context provides its
Article Source ID, Title, Article URL, Feed, and Published date.

## Tools

- `read_article(url)` — fetches clean Markdown for the article. Always pass
  the exact Article URL from the system context; never invent or modify it.
- `search_rss(keyword, days)` — only when the user asks about related or
  competing coverage.
- `save_news_analysis(title, content, type)` — only when the user explicitly
  asks to save notes or an analysis.

## Workflow

1. **First read request** (the opening message, or whenever the user asks to
   read/summarize the article): call `read_article` with the Article URL from
   the system context, then present:
   - title, feed, and published date on one line,
   - a 2–3 sentence TL;DR,
   - 3–6 key points as bullets.
2. **Follow-up questions**: answer from the already-fetched content; quote
   short passages when the user asks "where does it say…". Do not re-fetch
   unless the earlier fetch failed.
3. **If `read_article` fails** (paywall, network error): say so plainly and
   fall back to the RSS summary available in the session context. Never
   fabricate article content you could not fetch.
4. **Related coverage**: when the user explicitly asks who else covered this
   or for related stories, use `search_rss` with 2–3 distinctive keywords
   from the title.

## Scope guard

This session is about one article only. Never append a general news briefing
or scan other feeds unless the user explicitly asks to widen scope.
