---
name: taste-profile
description: "Build and maintain a taste profile from the user's library and interests. Use when the user wants to update their reading preferences, refresh their taste profile, add interests, or when a book is finished/analyzed and the profile may need updating. Triggers: update my taste, refresh my interests, my taste profile, what do I like, add interest, update preferences."
---

# Taste Profile

Build and maintain a living document that captures the user's reading preferences — themes, authors, styles, and intellectual interests — derived from their library and manual curation.

## When to Use

- User explicitly asks to update or review their taste profile
- User finishes reading or deeply analyzing a book (offer to update)
- User adds a new book to the library and wants it reflected
- User says "what do I like?" or "what are my interests?"
- Before generating recommendations (the `reading-list` skill loads this as input)
- User mentions a new interest or topic they want tracked

## File Location

- **Taste profile**: `lists/taste-profile.md`
- Create `lists/` if it doesn't exist

## Workflow

### 1. Scan the Library

For each book in `library/`:

1. Check `library/<folder>/analysis/outline.md` — extract themes, topics, structure, author's thesis
2. Check `library/<folder>/analysis/` for `summary.md`, `key-ideas.md`, `deep-dive-*.md` — these carry richer signal than outlines
3. Check `library/<folder>/notes/` for any user notes — these reveal what resonated personally (strongest taste signal)
4. If no analysis exists, read the beginning of `library/<folder>/markdown/` (preface, intro, TOC) to extract basic topics

**Signal strength** (strongest to weakest):
1. User notes and highlights — reveals personal resonance
2. Deep dives — reveals sustained interest in a specific subtopic
3. Key ideas and summaries — reveals what the user chose to extract
4. Outlines — structural overview, weakest signal but always available

### 2. Accept Manual Input

Let the user add interests directly:
- "I'm interested in X" → add to Intellectual Interests
- "I like author Y" → add to Favorite Authors
- "I don't like Z" → add to Books to Avoid

### 3. Synthesize into the Profile

Update `lists/taste-profile.md` using this template:

```markdown
# Taste Profile

**Last Updated:** YYYY-MM-DD

## Favorite Authors
- Author Name — <why: style, topics, etc.>

## Key Themes & Topics
- <Theme/Topic> — <what specifically appeals to the user>

## Preferred Genres & Styles
- <Genre or style> — <examples from library>

## Intellectual Interests
- <Broad intellectual areas the user gravitates toward>

## Books Read (Library)
| Book | Author | Year | Key Takeaway for Taste |
|------|--------|------|----------------------|
| <Title> | <Author> | <Year> | <what this reveals about taste> |

## Books to Avoid (optional)
- <topics/styles the user has explicitly disliked>

## Notes
- <any freeform observations about reading preferences>
```

### 4. Offer Next Steps

After updating, suggest:
- "Want me to get fresh recommendations based on your updated profile?" → delegate to `reading-list` skill
- "Want to explore a new topic?" → delegate to `reading-list` skill (topic exploration workflow)

## Cross-References

- **`reading-list`** — consumes the taste profile to generate recommendations. After updating the profile, offer to get recommendations.
- **`book-outline`** — outlines are a primary input for taste analysis. If a book has no outline, offer to generate one first for better taste extraction.
- **`book-analysis`** — key ideas and summaries feed directly into the taste profile. Richer analysis = richer profile.
- **`book-notes`** — user notes are the strongest taste signal. Prioritize them when available.
- **`deep-dive`** — a deep dive on a topic signals sustained interest. When a deep dive exists, its topic should be elevated in the taste profile.
- **`interactive-reading`** — when a user finishes reading a book (last chapter, or says "done"), offer to update the taste profile. Also check `notes/bookmark.md` for reading progress context.

## Tips

- The taste profile is a **living document** — it should grow and refine over time, not be rewritten from scratch each time
- Read the existing profile before updating; merge new signals with existing ones
- When a user rejects a recommendation from the `reading-list` skill, note *why* — this refines the profile
- Focus on *why* the user chose these books, not just *what* they're about
- Notes and highlights are stronger taste signals than outlines — prioritize them
- If the library is small (like now), lean more on manual curation; as it grows, library analysis becomes more powerful
