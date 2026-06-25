---
name: book-outline
description: "Generate structured outlines and overviews of books. Use when the user wants a bird's-eye view, table of contents summary, structural overview, chapter breakdown, or book outline. Triggers: outline this book, give me an overview, show the structure, what is this book about, table of contents, summarize the layout, book map."
---

# Book Outline

Generate a structured outline and overview of a book — a bird's-eye view of its structure, arguments, and narrative arc before (or during) reading.

The outline has two audiences:
1. **The user** — wants to see what a book covers, plan reading order, understand the arc
2. **Other skills** (`interactive-reading`, `book-analysis`) — need a machine-parseable navigation map with line-number anchors to jump directly to sections via `read` offset

The Navigation Map (line-numbered heading tree) is the most important section for agent consumption. Always generate it.

## When to Use

- User wants to know what a book covers before committing to reading it
- User asks "what is this book about?"
- User wants a structural overview or "map" of the book
- User asks for a table of contents summary
- User wants to see how arguments/chapters connect
- User is planning which chapters to read or skip

## Workflow

### 1. Identify the Book

- Check `<sourceId>/markdown/` for converted files
- If no markdown file exists, tell the user the book hasn't been ingested yet and suggest uploading it
- Confirm with the user if ambiguous

### 2. Scan the Structure

Read the beginning of the markdown file to capture:
- Title page, preface, introduction
- Table of contents (if present)
- All chapter/section headings

For large files, scan in chunks using `read` with offset/limit. The goal is to extract the **skeleton** — headings, subheadings, and structural markers — not the full content.

**Efficient heading scan:** Use bash to extract the structure:
```bash
grep -n '^#' "markdown/<book>.md" | head -200
```

This gives you all headings with line numbers without loading the full file.

**Build the Navigation Map:** From the grep output, generate a compact navigation map (see template). This is the most important section — it's what other skills (`interactive-reading`, `book-analysis`) use for direct `read` offset navigation. Every heading gets its line number preserved as `L<line>`. The map is essentially cleaned grep output: trivially parseable by agents, no table-parsing needed.

### 3. Read Key Passages

For each major section/part, read the first few paragraphs to understand:
- What the section covers
- The author's stated purpose or thesis
- Key concepts introduced

Focus on introductions, chapter openings, and conclusions — these carry the most structural signal.

### 4. Generate the Outline

Create a structured outline with these layers:

#### Layer 1: Book Overview
- **One-line summary**: What this book is about
- **Author's thesis**: The central argument or purpose
- **Structure**: How the book is organized (e.g., "3 parts, 15 chapters")
- **Audience & prerequisites**: Who it's for, what background is assumed

#### Layer 2: Navigation Map (always included)
- Line-number indexed heading tree, generated from `grep -n '^#'`
- This is the agent's primary lookup for `read` offset navigation
- Format: `L<line>  <heading>` — trivially parseable, no tables

#### Layer 3: Part/Section Breakdown
For each major part or section:
- Line range (L<start> to L<end>)
- Purpose of this section in the overall arc
- Chapter list with line numbers and one-line descriptions

#### Layer 4: Chapter Summaries (optional, on demand)
- 2-3 sentence summary per chapter
- Key concepts or arguments introduced
- Notable examples or case studies

#### Layer 5: Thematic Map (optional)
- Cross-cutting themes with line-number references to where they appear
- Recurring arguments or motifs
- How ideas build on each other across the book

### 5. Save the Outline

Save to the book's analysis folder:

```
<sourceId>/analysis/outline.md
<sourceId>/analysis/toc.json
```

**Always generate both files:**
- `outline.md` — Human-readable outline with Navigation Map (for agents and users)
- `toc.json` — Machine-readable TOC (for pi-tree app, zero-parsing)

#### outline.md Template

````markdown
# <Book Title> — Outline & Overview

**Author:** <Author>
**Date Generated:** YYYY-MM-DD
**Source File:** <sourceId>/markdown/<filename>.md

## One-Line Summary
<one sentence capturing the whole book>

## Author's Thesis
<the central argument or purpose, 1-2 paragraphs>

## Navigation Map

Line-number indexed heading tree. Use `read` with `offset=<line>` to jump to any section.
Other skills (interactive-reading, book-analysis) depend on this map for navigation.

```
L9     # <Book Title>
L121   ## Introduction
L213   ## Part I: Where I'm Coming From
L225   ### Chapter 1: My Call to Adventure
L240   #### Early Independence
L255   #### Discovering Markets
L279   ### Chapter 2: Crossing the Threshold
L345   #### Starting Bridgewater
L357   #### Modeling Markets as Machines
L375   #### Building the Business
...
```

Generate from: `grep -n '^#' "<file>" | sed 's/^/L/' | sed 's/:/     /'`
Remove noise lines (ads, headers, non-structural content). Keep all structural headings.
For books with messy markdown (Pandoc/Calibre artifacts), clean the titles:
- Remove `[]{#id .class}` spans, `{.class}` attributes, `<big>` HTML tags
- Remove `[]` markers, `**` bold markers, `◆` bullet markers
- Collapse extra whitespace

## Part I: <Title> — L<start> to L<end>
**Purpose:** <why this part exists in the book's arc>

| Ch | Title | Line | Summary |
|----|-------|------|---------|
| 1 | <title> | L<line> | <one line> |
| 2 | <title> | L<line> | <one line> |

## Part II: <Title> — L<start> to L<end>
...

## Thematic Map
- **<Theme 1>**: L<line1>, L<line2>, L<line3> — <how it develops>
- **<Theme 2>**: L<line4>, L<line5> — <how it develops>

## Reading Recommendations
- **Must-read chapters**: <which> (L<line>)
- **Skimmable chapters**: <which> (L<line>)
- **Prerequisite order**: <any chapters that must be read in sequence>
````

#### toc.json Template

A flat JSON array matching the Navigation Map entries. **Line numbers must match the book's markdown file** (same as the Navigation Map). Titles must be clean (no markup artifacts).

```json
[
  { "line": 9, "level": 1, "title": "<Book Title>" },
  { "line": 121, "level": 1, "title": "Introduction" },
  { "line": 213, "level": 1, "title": "Part I: Where I'm Coming From" },
  { "line": 225, "level": 2, "title": "Chapter 1: My Call to Adventure" },
  { "line": 240, "level": 3, "title": "Early Independence" },
  { "line": 255, "level": 3, "title": "Discovering Markets" }
]
```

Generate from the same data as the Navigation Map. The `level` field uses normalized hierarchy:
- `1` = parts, major divisions, chapters (top-level structural)
- `2` = chapters or major sections within parts
- `3` = sub-sections within chapters
- Use the book's actual structure to determine levels, not the raw `#` count from the markdown

**Rules:**
- Include only structural headings (parts, chapters, sections)
- Exclude: index, copyright, metadata, ads, reading break reminders
- Titles must be clean, human-readable text — no markdown/HTML artifacts
- Line numbers must be accurate — verify with `grep -n`

### 6. Offer Next Steps

- "Want me to expand on any section with more detail?"
- "Should I generate chapter-by-chapter summaries?"
- "Want to start reading a specific chapter?"
- "Should I save this outline?"

## Outline Depth Levels

Offer different depth levels based on user need:

| Level | Scope | When to Use |
|-------|-------|-------------|
| **Quick** | Navigation Map + 1-line book summary | Deciding whether to read |
| **Standard** | Navigation Map + all chapters + one-line descriptions | Planning reading order |
| **Detailed** | Navigation Map + chapters + key points + thematic map | Active reading companion |
| **Full** | Navigation Map + detailed chapter summaries + cross-references | Deep study / review |

All levels include the Navigation Map and `toc.json` — they're always generated.
Ask the user which level they want, or default to **Standard**.

## Tips

- The outline is a **map**, not the territory — keep it concise
- **The Navigation Map is the most important section** — other skills load it to navigate the book. Always include it. Line numbers must be accurate.
- **Line numbers (`L<line>`) are the navigation API** — they map directly to `read` offset values. Every chapter table row, thematic map entry, and reading recommendation should include them.
- Include **Source File** in the header so agents know which file the line numbers refer to without guessing.
- If the book has a clear argumentative arc, show how it builds (A → B → C)
- For narrative books (novels, memoirs), focus on plot arc and character development instead of arguments
- For textbooks/reference books, focus on topic hierarchy and dependencies
- Build on existing outlines rather than overwriting — read first, then update
- **Line numbers shift after re-conversion** — always re-run `grep -n '^#'` when updating an outline after re-converting a book
