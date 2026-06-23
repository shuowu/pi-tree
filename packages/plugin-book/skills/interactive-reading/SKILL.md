---
name: interactive-reading
description: Interactive reading and analysis of converted ebook markdown files. Use when the user wants to read, discuss, summarize, or analyze a book's content. Provides guided reading workflows, chapter navigation, Q&A, and book summaries.
---

# Interactive Reading

AI-assisted interactive reading with ebooks that have been converted to markdown.

## Workflow

Your working directory (`cwd`) is set to the `sources/` directory. Each source lives at `<sourceId>/` relative to cwd.

1. **Find the book** — the system context tells you the book directory (`<sourceId>/`). Check `<sourceId>/markdown/` for the converted `.md` file.
   - **If no markdown file exists** (directory missing, empty, or no `.md` files): the book hasn't been processed yet. Tell the user: "This book is still being processed. Please wait a moment and try again, or re-upload the book from the Library."
2. **Load the outline** — check `<sourceId>/analysis/outline.md`. If it exists, use it as the navigation map (chapter line numbers, thematic map, reading recommendations). If not, offer to generate one with `book-outline`.
3. **Read the book** — use `read` with offset/limit, using outline line numbers for precise navigation.
4. **Engage interactively** — discuss, summarize, analyze, or quiz.

## Reading Strategies

### Full Book Summary
Read the entire markdown file (use offset/limit for large books) and provide a structured summary with key themes, arguments, and takeaways.

### Chapter-by-Chapter Reading
- **If outline exists**: use its chapter table with line numbers to navigate directly via `read` offset — no grepping needed
- **If no outline**: identify chapter headings via `grep -n '^#' "<file>"`
- Read and discuss one chapter at a time, using the outline's one-line summaries for context
- After finishing a chapter, show the next chapter's outline entry and offer to continue

### Chapter Briefing — Always Provide One

At the start of every chapter (including when resuming mid-chapter), give a detailed pre-read briefing so the reader can decide which concepts to zoom in on. Cover:

1. **Chapter purpose** — what problem/question does it address? Why does it exist in the arc?
2. **Key concepts in plain language** — 2–3 sentences each, enough that the reader isn't lost without having read it
3. **The argument/flow** — how the chapter builds its case
4. **Concrete examples or analogies** — running example or case study anchor
5. **What to watch for** — 1–3 counterintuitive or especially important ideas
6. **Connection to previous/next**

**After the briefing, offer choices:** read through together, zoom in on a specific concept (handled inline), skim, or ask questions. Mention that `/tree` is available if they want to branch off and explore a tangent.

**Style:** Be concrete (not abstract). Aim for a 3–5 minute read, not a reproduction of the chapter. Scale briefing length to chapter size — short chapters get brief briefings.

### Focused Analysis
- **If outline exists**: check its **Thematic Map** first for cross-cutting themes and the chapters that address each one
- **If no outline**: grep for the topic
- Extract and discuss passages; compare across sections

### Q&A Mode
Search the markdown for relevant passages; answer with chapter/section citations.

## Using the Outline

The outline (`analysis/outline.md`) is the **navigation backbone**. Always check for it at session start.

- **Chapter table with line numbers** — instant `read` offset navigation
- **One-line chapter summaries** — context before diving in
- **Thematic map** — which chapters cover which themes
- **Reading recommendations** — must-read vs. skimmable, prerequisite order

**Starting a book:** show the outline's "Structure at a Glance" and "Reading Recommendations" to help plan reading.

**If outline is missing:** offer to generate one with `book-outline`. While waiting, fall back to grepping headings.

**Between chapters:** show the next chapter's outline entry (title + one-line summary) as a preview, then offer the full briefing.

---

## Bookmarks

Save reading progress at `<sourceId>/notes/bookmark.md` so the user can resume across sessions.

```markdown
# Bookmark: <Book Title>

- **File**: <sourceId>/markdown/<filename>.md
- **Outline**: <sourceId>/analysis/outline.md
- **Last Section**: Part II, Chapter 1: Embrace Reality and Deal with It
- **Offset**: 1500
- **Updated**: 2025-05-28T10:30:00Z

## Reading Log
- 2025-05-28 — Read Part I, Chapters 1–4 (lines 1–500)
- 2025-05-28 — Started Part II, Chapter 1 (line 1000–1500)
```

**Updating:**
- After each section/chapter read, update offset and section name
- On "bookmark this" / "save my place", update immediately
- Read existing bookmark first, then update

**Resuming:**
- On "resume" / "continue reading", check `<sourceId>/notes/bookmark.md` (and legacy `<sourceId>/analysis/bookmark.md`)
- Show: "You left off at **Part II, Ch 1** (line 1500). Resume?"
- After resuming, show the outline entry for the current chapter, then give the **detailed chapter briefing** (covering the whole chapter but flagging where the reader left off if mid-chapter)

---

## Notes & Analysis

For personal notes, save to `<sourceId>/notes/` (e.g., `session-<date>.md`, `chapter-NN.md`).

For structured analysis (summary, key ideas, quotes, comparisons), use the **`book-analysis`** skill — it handles templates and naming conventions.



## Using /tree While Reading

Pi's `/tree` navigation is a natural fit for interactive reading. The session is stored as a tree, so readers can branch at any point without losing their place.

### Reading Patterns with /tree

| Pattern | How /tree Helps |
|---|---|
| **Explore a tangent** | After discussing a concept, the user can `/tree` back to the chapter briefing and continue reading — the tangent becomes a branch, not a detour |
| **Try a reading approach** | Branch at a chapter start, try socratic style, then `/tree` back and try dense summary — keep both paths |
| **Resume after a deep dive** | `/tree` back to the chapter turn; pi's branch summary preserves what was explored |
| **Re-read with different focus** | Jump back to any chapter and re-read with new questions |

### Tips
- Encourage labeling key turns with `Shift+L` in `/tree` (e.g., "Ch3 briefing", "tangent on X") for easy navigation later
- Branch summaries keep context flowing between branches — suggest accepting summaries when switching
- `/tree` is lighter-weight than bookmarks for within-session navigation; bookmarks remain best for cross-session resume

## Commands

- `/books` — List all sources and their status
