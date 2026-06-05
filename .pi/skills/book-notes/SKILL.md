---
name: book-notes
description: "Take and manage personal reading notes for books. Use when the user wants to jot down thoughts, annotate passages, record reflections, or organize their reading notes. Triggers: take notes, my notes, annotate this, jot this down, add a note, reading notes, personal notes, I want to remember this."
---

# Book Notes

Take and manage personal reading notes — the user's own thoughts, annotations, and reflections while reading, separate from AI-generated analysis.

## When to Use

- User says "let me note this down" or "I want to remember this"
- User shares a personal thought or reflection about what they're reading
- User wants to annotate or comment on a passage
- User asks to see their existing notes
- User says "add to my notes" or "save this thought"

## Notes vs Analysis

**Notes** (`notes/`) are the reader's own words — personal, subjective, informal.
**Analysis** (`analysis/`) is AI-generated — structured, comprehensive, objective.

This skill handles `notes/`. Use the `book-analysis` skill for `analysis/`.

## Output Directory

All notes go to `notes/<Title>_<Author>_<Year>/` (or `library/<Title>_<Author>_<Year>/notes/`).

### File Naming

| File | Purpose |
|---|---|
| `general.md` | Freeform notes, undated thoughts |
| `chapter-NN.md` | Notes tied to a specific chapter |
| `session-YYYY-MM-DD.md` | Notes from a reading session |
| `bookmark.md` | Reading progress (managed by `interactive-reading`) |

## Workflow

### 1. Capture the Note

When the user wants to save a thought:

**Identify context:**
- Which book? (check current reading context or ask)
- Which chapter/section? (if actively reading, use current position)
- Is this tied to a specific passage? (capture the quote too)

**Enhance minimally:**
- Add the source reference (chapter, section, or page)
- If the user references a passage, include the quoted text
- Do NOT rewrite or "improve" the user's words — preserve their voice
- Optionally add a timestamp

### 2. Determine Where to Save

**By chapter:** If the user is reading a specific chapter, or the note is about a specific chapter:
```
notes/<Title>_<Author>_<Year>/chapter-NN.md
```

**General:** If the note is broad, cross-chapter, or the chapter is unknown:
```
notes/<Title>_<Author>_<Year>/general.md
```

**Session-based:** If the user explicitly wants session notes or is doing a long reading session:
```
notes/<Title>_<Author>_<Year>/session-YYYY-MM-DD.md
```

### 3. Save the Note

Read the existing file first (if any), then append.

#### Chapter Notes Template (`chapter-NN.md`)

```markdown
# Chapter NN: <Title> — Notes

## Quotes & Annotations

> "Passage text the user flagged"
— <line number or section>
💬 <user's comment or thought>

---

## Freeform Notes
- <user's thoughts>
- <user's thoughts>
```

#### General Notes Template (`general.md`)

```markdown
# <Book Title> — Reading Notes

## YYYY-MM-DD
- <note content>

---
```

### 4. Confirm

Briefly confirm what was saved:
- "Noted in chapter 3 notes: [summary of what was captured]"
- "Added to your general notes for <Book Title>"

## Note-Taking Commands

Users can give notes in natural language:

| User says | Action |
|---|---|
| "Note: this reminds me of X" | Save to current chapter or general notes |
| "Quote this passage" | Save quoted text with source reference |
| "My thoughts on this chapter" | Save to chapter notes, prompt for elaboration |
| "Show my notes" | Display all notes for the current book |
| "Show my notes on chapter 5" | Display chapter-05.md |
| "Organize my notes" | Read and restructure scattered notes |

## Reading Notes Aloud

When the user is reading and says something like:
- "I think the author is saying..."
- "This connects to..."
- "I disagree because..."
- "This reminds me of..."

These are implicit notes. Offer to save them:
"Want me to save this thought in your notes?"

## Retrieving Notes

### Show notes for a book
```
ls notes/<Title>_<Author>_<Year>/
```
Then read and present the requested file.

### Search across notes
```bash
grep -r "keyword" notes/<Title>_<Author>_<Year>/
```

### Show all notes
```bash
find notes/ -name "*.md" -not -name "bookmark.md"
```

## Organizing Notes

When the user asks to organize or consolidate notes:

1. Read all note files for the book
2. Identify themes, connections, and duplicates
3. Propose a structure (don't reorganize without asking)
4. Offer to create a consolidated `reading-summary.md` with the user's key takeaways

## Session Notes Pattern

For active reading sessions, maintain a running session note:

```markdown
# Reading Session — YYYY-MM-DD

## Currently Reading
- Chapter NN: <Title>

## Notes
- <time or section marker> <note>
- <time or section marker> <note>

## Questions to Explore Later
- <question>
- <question>
```

Append to this throughout the session. At the end, offer to distribute notes into chapter-specific files.

## Tips

- **Preserve the user's voice.** Never rephrase their notes into "better" prose. Add structure and references, but keep their words intact.
- **Keep notes lightweight.** The point is capturing thoughts quickly, not producing polished writing.
- **Timestamp entries** in `general.md` and session files so notes have chronological context.
- **Link notes to passages.** Always include the source (chapter, line, or quote) so the user can find the context later.
- **Don't duplicate analysis.** If the user's note overlaps with something in `analysis/`, that's fine — notes are personal, analysis is comprehensive.
- **Offer, don't insist.** Suggest saving notes, but don't force it if the user is just thinking out loud.
- **Respect the separation.** Notes are the user's. Analysis is the AI's. Don't mix the two files.
