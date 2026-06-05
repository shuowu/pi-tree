---
name: reference-book
description: "Designate books as reference material and ask questions against them. Use when the user wants to use one or more books as a knowledge base to query — asking factual questions, looking up details, comparing what books say about a topic, or getting sourced answers with citations. Triggers: use as reference, reference book, ask about this book, look this up in, what does X say about, according to my books, search my library for, reference question, check my books."
---

# Reference Book

This skill treats designated books as a **searchable knowledge base**. The user marks books as "reference" and then asks freeform questions — the skill searches across all referenced books, finds relevant passages, and synthesizes a cited answer.

## When to Use

- User wants to designate a book as a reference ("add this to my references", "use X as a reference book")
- User asks a factual or conceptual question and wants the answer sourced from their books
- User says "according to my books" or "what does X say about Y"
- User wants to compare what multiple books say about a topic
- User wants to look up a specific detail, quote, or concept from a book they've read

## Reference Registry

The reference registry is a single file listing which books are active references.

### File Location
```
library/.references.md
```

### Format
```markdown
# Reference Library

| Book | Folder | Markdown Path | Added |
|------|--------|---------------|-------|
| Principles | Principles_Dalio_2017 | library/Principles_Dalio_2017/markdown/Principles.md | 2025-06-01 |
| The Coming Wave | The Coming Wave_Suleyman_2023 | library/The Coming Wave_Suleyman_2023/markdown/The Coming Wave.md | 2025-06-01 |
```

The registry enables fast lookup: when a question comes in, read the registry, then search only the listed books.

## Workflow

### Adding a Reference

1. User says "add X as a reference" or "use X as a reference book"
2. Find the book in `library/` — scan folder names, fuzzy match
3. Confirm the book has a converted markdown file in `library/<folder>/markdown/`
4. If no markdown exists, check `library/<folder>/book/` and offer to convert with `ebook_convert`
5. Append the book to `library/.references.md` (create the file if it doesn't exist)
6. Confirm to the user

#### Adding Multiple Books
If the user says "use all my books as references" or "add everything":
```bash
ls library/
```
Add each folder that has a `markdown/` subdirectory.

### Removing a Reference

1. User says "remove X from references" or "stop using X as reference"
2. Find the entry in `library/.references.md`
3. Remove the row
4. Confirm

### Listing References

When the user says "show my references" or "what reference books do I have?":
1. Read `library/.references.md`
2. Present the list in a clean format

### Answering a Question

This is the core use case: the user asks any question, and you answer it **using only or primarily their reference books**.

#### Step 1: Read the Registry

Read `library/.references.md` to know which books to search.

If the file doesn't exist or is empty, prompt the user to add reference books first.

#### Step 2: Search Across References

Search all referenced books for keywords related to the question:

```bash
# Search for keywords across all reference books
grep -n -i "keyword1\|keyword2\|keyword3" "library/<folder>/markdown/<file>.md" | head -40
```

Do this for each referenced book. Collect all matches.

**Tips for effective searching:**
- Extract 2–5 key terms from the user's question
- Use broad searches first, then narrow down
- Search for synonyms and related terms if initial search is sparse
- For conceptual questions, also search for chapter/section titles that might address the topic

#### Step 3: Read Relevant Passages

For each match, read the surrounding context (not just the matched line):

```bash
# Read 30 lines around a match at line 800
read "library/<folder>/markdown/<file>.md" offset=785 limit=40
```

Load enough context to understand the passage — typically 20–40 lines around each match.

#### Step 4: Check Outlines and Existing Analysis (Optional)

If quick grep results are sparse or the question is broad:
1. Check `library/<folder>/analysis/outline.md` for the thematic map — it shows which chapters cover which topics
2. Check `library/<folder>/analysis/summary.md` or `key-ideas.md` for pre-digested insights
3. Use these to find the right chapters, then read those sections directly

This is especially useful for broad questions like "what does this book say about leadership?"

#### Step 5: Synthesize the Answer

Structure the answer with citations:

```markdown
## Answer

<Direct answer to the question, 2-4 paragraphs>

### Sources

**From *Principles* (Dalio, 2017):**
> "Relevant quote or passage" — Part II, Ch 3

The author argues that...

**From *The Coming Wave* (Suleyman, 2023):**
> "Relevant quote or passage" — Chapter 7

This book takes the view that...

### Comparison (if multiple books address the topic)
- *Principles* emphasizes X
- *The Coming Wave* focuses on Y
- Both agree on Z
```

### Key Principles for Answers

- **Cite sources.** Every factual claim should reference which book (and ideally which chapter/section) it comes from
- **Quote directly** when the author's exact words matter. Use `>` blockquotes with chapter attribution
- **Distinguish between books.** Make it clear which book says what — never blend them into a generic answer
- **Note when books disagree.** If referenced books give different perspectives, highlight the contrast
- **Acknowledge gaps.** If none of the referenced books address the question fully, say so. Don't fabricate answers
- **Offer to go deeper.** If a passage is particularly relevant, offer to read the full chapter or section

### Follow-up Questions

After answering, encourage continued use:
- "Want me to search for anything else in your references?"
- "Should I add more books to your reference library?"
- If the question revealed a gap, suggest books that might cover it

## Scoped vs. Unscoped Questions

### Scoped (user specifies a book)
> "What does *Principles* say about decision-making?"

Search only the specified book. Use the outline to find relevant chapters efficiently.

### Unscoped (search all references)
> "What do my books say about AI regulation?"

Search all referenced books. Present results per-book, then synthesize.

### Cross-reference
> "Compare how Dalio and Suleyman think about risk"

Search both books for "risk" and related terms. Present a structured comparison.

## Tips

- **Always read the registry first** — don't assume which books are referenced
- **Grep is your best friend** — use it liberally to find relevant passages without reading entire books
- **Read context around matches** — a single matched line is rarely enough; load 20–40 lines of context
- **Use outlines as a shortcut** — when available, the thematic map tells you exactly where to look
- **Don't read entire books for each question** — search, locate, read only what's needed
- **Build on existing analysis** — if `summary.md` or `key-ideas.md` exists, check it before re-reading chapters
- **Keep the registry simple** — one file, one table, easy to parse
- **When adding a book, verify the markdown exists** — don't add books that haven't been converted
- **For ambiguous book names**, do a fuzzy match against `library/` folders and confirm with the user
- **Update the Added date** when re-adding a book that was previously removed

## Commands

- `/ref add <book>` — Add a book to the reference library
- `/ref add all` — Add all books with converted markdown
- `/ref remove <book>` — Remove a book from the reference library
- `/ref list` — Show all reference books
- `/ref ask <question>` — Ask a question against reference books (can also just ask naturally)
- `/ref` — Show the reference library status

## Integration with Other Skills

- **book-outline**: Use outlines to navigate reference books efficiently when answering questions
- **book-analysis**: Existing summaries and key-ideas files speed up reference lookups
- **deep-dive**: If a reference question reveals a topic worth exploring in depth, suggest a deep dive
- **taste-profile**: When adding reference books, consider updating the taste profile
- **reading-list**: If the user's reference questions reveal interest gaps, suggest books to fill them
