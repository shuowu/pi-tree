---
name: book-context
description: "Explore author background, historical context, literary significance, and related information for books. Use when the user wants to understand who wrote a book, the era it was written in, its influences, critical reception, or biographical details about the author. Triggers: who is the author, tell me about the author, background of this book, historical context, literary context, author info, about the writer."
---

# Book Context

This skill enriches the reading experience by exploring the world around a book — who wrote it, why, when, and how it fits into literary and historical traditions.

## When to Use

- User asks about the author's life, background, or other works
- User wants historical or cultural context for a book
- User asks about literary influences or the book's significance
- User wants to understand why a book was written
- User asks about critical reception or legacy

## Workflow

### 1. Identify the Book

If the user is actively reading, check for the book in `library/<Title>_<Author>_<Year>/markdown/` or `markdown/` (legacy). Use the filename or ask the user to confirm which book they're asking about.

### 2. Research Using Web Search

Use the `brave-search` skill to look up information. Construct targeted queries:

**Author Biography:**
```bash
~/.pi/agent/skills/brave-search/search.js "\"<Author Name>\" biography author" --content -n 3
```

**Other Works by the Author:**
```bash
~/.pi/agent/skills/brave-search/search.js "\"<Author Name>\" bibliography works list" -n 5
```

**Historical Context:**
```bash
~/.pi/agent/skills/brave-search/search.js "\"<Book Title>\" historical context background" --content -n 3
```

**Literary Significance:**
```bash
~/.pi/agent/skills/brave-search/search.js "\"<Book Title>\" literary analysis significance" --content -n 3
```

**Author's Influences:**
```bash
~/.pi/agent/skills/brave-search/search.js "\"<Author Name>\" literary influences inspiration" -n 3
```

**Critical Reception:**
```bash
~/.pi/agent/skills/brave-search/search.js "\"<Book Title>\" critical reception reviews legacy" -n 3
```

### 3. Extract from Specific Sources

For deeper dives, use content extraction on authoritative pages:
```bash
~/.pi/agent/skills/brave-search/content.js https://en.wikipedia.org/wiki/<Article>
```

Good sources to look for in results:
- Wikipedia / Britannica
- Literary encyclopedias and databases
- Publisher author pages
- University literary archives
- The Paris Review, Literary Hub, The Guardian books section

### 4. Present Findings

Organize the information in a reader-friendly format:

- **Author Profile** — Who they are, nationality, era, key life events
- **Why They Wrote It** — Motivation, circumstances, personal connection
- **Historical Backdrop** — What was happening in the world at the time
- **Literary Context** — Movement, genre, influences, contemporaries
- **Legacy** — Impact, awards, adaptations, lasting significance

### 5. Connect to Reading

Tie the context back to the user's reading experience:
- Point out passages or themes that reflect the author's life
- Suggest which chapters to read with the context in mind
- Recommend related books by the same author or contemporaries

## Tips

- Start broad (author biography), then go specific (this particular book's context)
- Use `--content` flag when you need detailed information, skip it for quick overviews
- Cross-reference multiple sources for accuracy
- Keep the tone conversational — this enriches reading, not a research paper
- If the book is part of a series, explore the series arc and reading order
- When the author has a fascinating life story, lean into the narrative — it makes the book more engaging
- Use `ctx_search` to recall previously researched context for a book

## Example Queries from Users

- "Tell me about the author of this book"
- "What was happening when this was written?"
- "Why did they write this?"
- "What else has this author written?"
- "What influenced this book?"
- "How was this book received?"
- "What should I know before reading this?"
