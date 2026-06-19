---
name: book-analysis
description: "Generate and save structured book analysis. Use when the user asks to summarize a book, extract key ideas, collect quotes, compare books, or save any reading analysis to files. Triggers: summarize this book, save notes, extract key ideas, collect quotes, compare books, write analysis, save summary."
---

# Book Analysis

This skill handles generating structured analysis from converted ebooks and persisting it to the `analysis/` directory.

## When to Use

- User asks to summarize a book
- User wants key ideas or takeaways extracted
- User wants notable quotes collected
- User asks to compare two or more books
- User says "save my notes" or "write this up"

## Output Directory

All analysis goes to `<sourceId>/analysis/`. One subfolder per book.

### Naming Convention

| File | Purpose |
|---|---|
| `summary.md` | Overall book summary with themes and chapter breakdowns |
| `key-ideas.md` | Extracted core ideas with evidence and applications |
| `chapter-NN-notes.md` | Per-chapter notes (NN = zero-padded chapter number) |
| `quotes.md` | Notable quotes with source location |
| `context.md` | Author background and historical context |
| `comparison.md` | Cross-book thematic comparisons |

## Workflow

### 1. Identify the Source

- Check `<sourceId>/markdown/` for the converted book
- If no markdown file exists, tell the user the book hasn't been ingested yet and suggest uploading it
- Confirm the book title with the user if ambiguous

### 2. Read the Content

- Use `read` with offset/limit to process the markdown in chunks
- For full-book analysis, read in chunks using offset/limit
- For targeted analysis, search for specific topics/themes

### 3. Generate Analysis

Choose the appropriate analysis type based on the user's request:

#### Summary (`summary.md`)
- One-line summary
- 3-5 key themes
- Chapter-by-chapter breakdown (2-3 sentences each)
- Overall takeaway

#### Key Ideas (`key-ideas.md`)
- Each idea as a separate section
- Core concept, evidence from text, practical application
- Number and name each idea

#### Chapter Notes (`chapter-NN-notes.md`)
- Chapter summary
- Bullet-point key takeaways
- Notable passages (quoted with attribution)
- Questions for reflection

#### Quotes (`quotes.md`)
- Blockquote format
- Source: chapter/section reference
- Group by theme if the collection is large

#### Cross-Book Comparison (`comparison.md`)
- Identify shared themes across books
- Contrast different approaches or perspectives
- Use a table for side-by-side comparison
- Note where books complement or contradict each other

### 4. Save to File

- Use the book's analysis folder: `<sourceId>/analysis/`
- Create if it doesn't exist: `mkdir -p "<sourceId>/analysis"`
- Write the file using the `write` tool
- Tell the user what was saved and where

### 5. Offer Next Steps

After saving, suggest:
- Reading the next chapter and generating notes
- Extracting quotes from what was discussed
- Comparing with another book in the library
- Generating a key-ideas summary

## Tips

- Always include the book title and date in the file header
- Quote the text directly (with `>`) rather than paraphrasing for quotes files
- Keep summaries concise — the user can always re-read the chapter
- For large books, offer to do chapter-by-chapter analysis rather than all at once
- Cross-reference with `grep` for any previously indexed content
- When doing comparison, list all books being compared in the header
- If previous analysis exists for a book, read it first and build on it rather than overwriting
