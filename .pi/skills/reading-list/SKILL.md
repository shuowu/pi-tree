---
name: reading-list
description: "Manage a reading list and get book recommendations based on the user's taste profile. Use when the user wants book recommendations, asks what to read next, wants to add/remove books from their list, or wants to explore a new topic. Triggers: recommend me books, what should I read, reading list, add to my list, remove from my list, show my list, books like this, suggest books, find me something to read, I want to read about."
---

# Reading List & Recommendations

Manage a personal reading list and generate book recommendations using the user's taste profile and web search.

## When to Use

- User asks for book recommendations
- User wants to see, add to, or remove from their reading list
- User asks "what should I read next?"
- User wants books similar to one they've read
- User wants to explore a new topic ("I want to read about X")

## File Locations

- **Reading list**: `lists/reading-list.md`
- **Taste profile** (read-only, maintained by `taste-profile` skill): `lists/taste-profile.md`
- Create `lists/` if it doesn't exist

## Workflows

### A. Get Recommendations

Use the taste profile + web search to find books the user would enjoy.

#### Step 1: Load Taste Profile

Read `lists/taste-profile.md`. If it doesn't exist or is stale:
- Suggest updating it first via the `taste-profile` skill
- If the user agrees, delegate: "I'll update your taste profile first, then find recommendations."

#### Step 2: Web Search

Use the `brave-search` skill to search for books. Craft queries from the taste profile:

- **By theme**: "best books about <theme>"
- **By similarity**: "books like <title from library>"
- **By author affinity**: "books similar to <author>"
- **By combination**: "best books about <topic> for readers who liked <title>"
- **Best-of lists**: "best nonfiction books 2024 <topic>"

Run 2-4 searches with different angles for diverse results.

#### Step 3: Filter & Present

- Cross-reference with the existing reading list and library to avoid duplicates
- Present 4-6 recommendations with:
  - Title and author
  - One-line summary
  - **Why recommended** — tied to specific items in the taste profile
  - Source (which search query found it)

#### Step 4: Let User Choose

Offer to add selected books to the reading list. Do **not** add automatically.

### B. Manage Reading List

A simple markdown list of books the user wants to read.

#### Reading List Template

```markdown
# Reading List

**Last Updated:** YYYY-MM-DD

## To Read

| # | Title | Author | Why | Added |
|---|-------|--------|-----|-------|
| 1 | <Title> | <Author> | <reason or connection to taste> | YYYY-MM-DD |

## Explored / Decided Not to Read

| Title | Author | Why Not |
|--------|--------|---------|
| <Title> | <Author> | <brief reason> |
```

#### Operations

- **Add**: "add <book> to my list" — append to the To Read table
- **Remove**: "remove <book>" — move to "Explored / Decided Not to Read" with reason, or delete if preferred
- **View**: "show my list" — display the current table
- **Prioritize**: "what should I read next?" — rank the list by fit with taste profile, recommend the top pick
- **Archive**: suggest moving stale entries (listed long time, no action) to "Explored"

### C. Topic Exploration

When the user wants to explore a topic they haven't read about:

1. **Clarify interest** — ask what drew them to the topic, what angle they care about
2. **Search** — find introductory and definitive books on that topic via web search
3. **Present options** — with reading order suggestions (e.g., "start here, then this")
4. **Update taste profile** — suggest adding the new topic to the taste profile (delegate to `taste-profile` skill)
5. **Add to list** — offer to add selected books

### D. "What Should I Read Next?"

When the user wants a personalized pick:

1. Load `lists/reading-list.md` and `lists/taste-profile.md`
2. If the reading list has entries, rank them by taste fit and recommend the top 1-2
3. If the list is empty or stale, generate fresh recommendations (Workflow A)
4. Consider what the user has read recently — suggest variety (different topic/author from their last book)

## Cross-References

- **`taste-profile`** — this skill reads the taste profile as input. If the profile is missing or stale, delegate to `taste-profile` to build/update it first. When a user shows interest in a new topic during exploration, suggest updating the profile via `taste-profile`.
- **`brave-search`** — used for all web searches to find recommendations and explore topics.
- **`interactive-reading`** — when a user decides to read a book from the reading list and adds it to the library, offer to start an interactive reading session.
- **`book-outline`** — once a recommended book is added to the library and converted, generate an outline to help the user decide if it matches their expectations.
- **`book-analysis`** — after finishing a recommended book, use analysis to enrich the taste profile (via `taste-profile` skill) and improve future recommendations.
- **`deep-dive`** — when a recommendation resonates strongly with the user, offer a deep dive into a topic from the book.

## Tips

- Always explain *why* a book is recommended by connecting it to the taste profile — this builds trust and helps the user refine their profile
- For recommendations, mix familiar territory with adjacent explorations — don't just suggest more of the same
- When the user rejects a recommendation, ask why briefly and note it — suggest updating the taste profile to reflect this
- Keep the reading list manageable — offer to archive books that have sat unread for a long time
- The "What Should I Read Next?" workflow should feel like a knowledgeable friend recommending a book, not an algorithm dumping results
