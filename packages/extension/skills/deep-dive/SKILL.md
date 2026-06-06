---
name: deep-dive
description: "Deep-dive into a specific topic from a book in a dedicated, standalone session. Heavyweight analysis with book discovery, cross-chapter tracing, cross-book comparison, and saved output. Use when the user wants a thorough, comprehensive exploration — possibly across chapters or books — as its own focused session. NOT for: a quick inline drill-down during active reading (handle inline by expanding the concept), or pulling back to the big picture (handle inline by summarizing position in the book's arc). Triggers: deep dive into X, full analysis of X, trace this theme across chapters, compare X across my books, dedicated exploration of X."
---

# Deep Dive

**Dedicated sessions** exploring one topic in depth. Uses existing outlines and analysis to orient quickly without reading entire books.

## When to Use

- User says "deep dive into X" or "go deeper on this topic"
- User wants cross-chapter or cross-book analysis on a single thread
- User is in a dedicated session and wants to focus without loading the full book

## Step 1: Identify the Book

Book folders in `library/` use the pattern `<Title>_<AuthorLastName>_<Year>`.

Try in order:
1. **Explicit mention** — user names the book; match via `ls library/`
2. **Search outlines** (fastest topic match): `grep -rl "keyword" library/*/analysis/outline.md`
3. **Search all analysis**: `grep -rl "keyword" library/*/analysis/`
4. **Interview the user** — list books with `ls library/` and ask which one. Accept number, title, author keyword, or description. **Never guess silently.**

## Step 2: Orient Using Existing Artifacts

**Before reading any book content**, check what already exists.

```bash
cat "library/<Title>_<Author>_<Year>/analysis/outline.md"  # chapter map + line numbers
ls "library/<Title>_<Author>_<Year>/analysis/"              # existing summary, key-ideas, deep-dives
ls "library/<Title>_<Author>_<Year>/notes/"                 # user notes/questions
```

Read relevant ones to avoid duplicating work. **If an outline exists, use it to jump directly to relevant chapters.**

## Step 3: Locate the Content

Using the outline as a map, go directly to relevant sections:

```bash
# Find where the topic appears
grep -n -i "topic keyword" "library/<Title>_<Author>_<Year>/markdown/<file>.md" | head -30

# Read only the relevant sections
read "library/<Title>_<Author>_<Year>/markdown/<file>.md" offset=<line-10> limit=70
```

**Never read the entire book.** Only load the sections you need.

If no outline exists, extract headings first: `grep -n '^#' "<file>.md" | head -200`

## Step 4: Deep-Dive Analysis

Load relevant sections and analyze based on user interest:

- **Thematic trace** — how the topic evolves across chapters; shifts in argument/tone
- **Concept breakdown** — define in author's words; identify arguments, evidence, assumptions, gaps
- **Cross-reference** — `grep -rl "keyword" library/*/markdown/` to find related content in other books; compare definitions and conclusions
- **Critical lens** — weak points, counterarguments, theory vs. practice
- **Practical extraction** — actionable takeaways, frameworks, mental models

## Step 5: Save the Deep Dive

Save to `library/<Title>_<Author>_<Year>/analysis/deep-dive-<sanitized-topic>.md`.

Use this skeleton, adapt to actual content:

```markdown
> **Session handoff.** Produced in a dedicated deep-dive session.

# Deep Dive: <Topic> — <Book Title>

**Date:** YYYY-MM-DD
**Source:** <Book Title> by <Author> (<Year>)
**Scope:** Chapters <X>–<Y> (and any cross-references)

## Topic Overview
<1–2 paragraph summary>

## How the Topic Develops
### <Chapter/Section 1>
- Key points, evidence, notable quotes
### <Chapter/Section 2>
...

## Core Arguments
1. **<Argument>**: <explanation>

## Assumptions & Gaps
- What the author assumes / leaves unaddressed

## Cross-References
- *<Other Book>*: <how it relates>

## Key Quotes
> "..." — Chapter X

## Takeaways
- <actionable insight>

## Open Questions
- <question this deep dive raised>
```

## Step 6: Offer Next Steps

- Generate an outline if one doesn't exist
- Compare with another book's treatment of the topic
- Continue the deep dive on a related sub-topic
- Update the taste profile (signals strong interest)
- Get recommendations via `reading-list`
- `/tree` back to the reading session — pi's branch summary will preserve the deep dive context
- If in a standalone session, summarize findings inline and suggest where to continue reading

## Tips

- **Read the outline first.** Fastest way to orient. If missing, suggest generating one after.
- **Build on prior analysis.** Always check `analysis/` before reading.
- **Stay focused.** One topic per session, not a full book summary.
- **Quote the text** with chapter/line references.
- **Only load the sections you need**, never the entire book.
- **Name files descriptively:** `deep-dive-meritocracy.md`, not `deep-dive-03.md`.

## Commands

- `/deep-dive <topic>` — Start a deep dive on a topic (auto-identifies book)
- `/deep-dive <book> / <topic>` — Specify both book and topic
- `/deep-dives` — List all saved deep dives across all books
