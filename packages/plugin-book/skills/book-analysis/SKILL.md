---
name: book-analysis
description: "Generate and save structured book analysis. Use when the user asks to summarize a book, extract key ideas, collect quotes, compare books, or save any reading analysis to files. Triggers: summarize this book, save notes, extract key ideas, collect quotes, compare books, write analysis, save summary."
---

# Book Analysis

Generate structured analysis from ebooks and save to `<sourceId>/analysis/`.

## Context You Already Have

Your system context includes the book's **Table of Contents** with line numbers. Use these to navigate directly to relevant chapters — no grepping needed.

A richer outline with chapter summaries and thematic map may be at `<sourceId>/analysis/outline.md`. Read it once for deeper structural context.

## When to Use

- User asks to summarize a book or chapters
- User wants key ideas or takeaways extracted
- User wants notable quotes collected
- User asks to compare two or more books
- User says "save my notes" or "write this up"

## Output Files

All analysis goes to `<sourceId>/analysis/`:

| File | Purpose |
|---|---|
| `summary.md` | Overall book summary with themes and chapter breakdowns |
| `key-ideas.md` | Core ideas with evidence and applications |
| `chapter-NN-notes.md` | Per-chapter notes (NN = zero-padded chapter number) |
| `quotes.md` | Notable quotes with source location |
| `comparison.md` | Cross-book thematic comparisons |

## Workflow

1. **Locate content** — use the TOC line numbers (in your system context) with the `read` tool's offset parameter
2. **Read in chunks** — use offset/limit for large sections
3. **Generate analysis** — match the format below to the user's request
4. **Save** — write to `<sourceId>/analysis/` using the `write` tool
5. **Offer next steps** — suggest related analysis or continuing to the next chapter

## Analysis Formats

### Summary (`summary.md`)
- One-line summary
- 3–5 key themes
- Chapter-by-chapter breakdown (2–3 sentences each)
- Overall takeaway

### Key Ideas (`key-ideas.md`)
- Each idea as a separate section
- Core concept, evidence from text, practical application

### Chapter Notes (`chapter-NN-notes.md`)
- Chapter summary
- Bullet-point key takeaways
- Notable passages (quoted with attribution)
- Questions for reflection

### Quotes (`quotes.md`)
- Blockquote format with chapter/section reference
- Group by theme if the collection is large

### Cross-Book Comparison (`comparison.md`)
- Shared themes across books
- Contrasting approaches (use tables for side-by-side)
- Where books complement or contradict each other

## Tips

- **The TOC is in your system context** — use line numbers for direct navigation
- Always include the book title and date in file headers
- Quote text directly (`>`) rather than paraphrasing for quotes files
- Keep summaries concise — the user can always re-read the chapter
- For large books, offer chapter-by-chapter analysis rather than all at once
- If previous analysis exists, read it first and build on it rather than overwriting
