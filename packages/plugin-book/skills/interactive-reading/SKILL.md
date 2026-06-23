---
name: interactive-reading
description: Interactive reading and analysis of converted ebook markdown files. Use when the user wants to read, discuss, summarize, or analyze a book's content. Provides guided reading workflows, chapter navigation, Q&A, and book summaries.
---

# Interactive Reading

AI-assisted interactive reading with ebooks converted to markdown.

## Context You Already Have

Your system context includes the book's **Table of Contents** with line numbers. Use these line numbers directly with the `read` tool's `offset` parameter to jump to any section — no grepping needed.

A richer outline with chapter summaries, thematic map, and reading recommendations is at `<sourceId>/analysis/outline.md`. Read it once at session start for deeper context.

## Responding to User Requests

### Starting a session
1. Read `<sourceId>/analysis/outline.md` (one tool call)
2. Present a brief overview: what the book is about, how it's structured, and recommended starting points
3. Ask where they'd like to begin

### "Read chapter N" / "Next chapter"
1. Find the chapter's line number from the TOC (already in your context)
2. `read` the content using that offset
3. Give a **chapter briefing** first, then discuss

### Questions about the book
1. Use the TOC to identify which chapters are relevant
2. `read` those sections using line numbers
3. Answer with chapter/section citations

### "Continue reading" / "Resume"
1. Check `<sourceId>/notes/bookmark.md` for saved position
2. `read` from the bookmarked offset
3. Briefly recap where they left off, then continue

## Chapter Briefings

Before or at the start of each chapter, give a concise briefing:

1. **Purpose** — what problem/question does this chapter address?
2. **Key concepts** — 2–3 sentences each, concrete not abstract
3. **The argument flow** — how it builds its case
4. **What to watch for** — 1–2 counterintuitive or important ideas
5. **Connection** — how it relates to previous/next material

Scale briefing length to chapter size. Short chapters get brief briefings.

After the briefing, offer choices: read together, zoom into a concept, skim, or ask questions.

## Bookmarks

Save reading progress at `<sourceId>/notes/bookmark.md`:

```markdown
# Bookmark: <Book Title>

- **File**: <sourceId>/markdown/<filename>.md
- **Last Section**: <section name>
- **Offset**: <line number>
- **Updated**: <timestamp>

## Reading Log
- <date> — Read <chapters> (lines <range>)
```

Update after each chapter read. On "bookmark this" / "save my place", update immediately.

## Notes & Analysis

For personal notes, save to `<sourceId>/notes/`.
For structured analysis (summary, key ideas, quotes), use the **`book-analysis`** skill.

## Tips

- **The TOC is in your system context** — use it for instant navigation, no tool calls needed to find chapters
- **Read the outline once** at session start for chapter summaries and thematic map
- **Use line numbers from the TOC** as `read` offset values — they map directly
- Keep responses conversational and concrete — avoid reproducing the chapter verbatim
- After a chapter, show the next chapter's TOC entry as a preview
