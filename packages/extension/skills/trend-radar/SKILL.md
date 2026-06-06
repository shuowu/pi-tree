---
name: trend-radar
description: "Track new book trends, monitor trending books in the user's areas of interest, and surface timely recommendations. Use when the user wants to discover what's new, what's trending, best-of lists, upcoming releases, award news, or fresh book recommendations tied to current discourse. Triggers: what's trending, new books, trend radar, fresh picks, what's new in books, best books of, book awards, new releases, what's hot."
---

# Trend Radar

Track new book trends, monitor what's gaining attention in the user's areas of interest, and surface timely recommendations that connect to their taste profile.

## When to Use

- User asks "what's trending in books?"
- User wants to discover new releases or best-of lists
- User wants to know about book awards, buzz, or emerging topics
- User asks for fresh recommendations beyond their reading list
- Periodic "radar sweep" to keep the trend document current
- User asks about a specific trending topic and wants book angles on it

## File Locations

- **Trend radar**: `lists/trend-radar.md`
- **Taste profile** (read-only): `lists/taste-profile.md`
- **Reading list** (read-only, for dedup): `lists/reading-list.md`
- Create `lists/` if it doesn't exist

## Workflows

### A. Radar Sweep (Full Update)

Run a comprehensive trend scan across the user's interest areas.

#### Step 1: Load Context

Read:
- `lists/taste-profile.md` — themes, genres, authors, interests
- `lists/trend-radar.md` — previous radar state (if exists) to detect what's new
- `lists/reading-list.md` — to avoid recommending what's already listed

#### Step 2: Multi-Angle Search

Use `brave-search` to run 5-8 searches across these categories:

| Category | Example Query | Purpose |
|----------|--------------|---------|
| **Taste-aligned trends** | "best new books about decision making 2026" | Books in user's interest areas |
| **Author watch** | "new book Ray Dalio 2026" or "Mustafa Suleyman new book" | New releases from favorite/authors-in-orbit |
| **Genre best-of** | "best nonfiction books 2026 so far" | Broad best-of lists |
| **Award buzz** | "book awards 2026 nominations" | Prestige signal |
| **Cultural moments** | "most talked about books 2026" | Books in the cultural conversation |
| **Adjacent exploration** | "best books about technology governance 2026" | One step beyond current interests |
| **Emerging topics** | "trending topics nonfiction books 2026" | What's new in the discourse |

Use `--freshness` flag to focus on recent results:
- `pm` (past month) for hot/trending
- `py` (past year) for best-of-year lists
- Custom date range for award seasons

Run 2-3 searches with `--content` for deeper extraction from best-of lists and award pages.

#### Step 3: Process & Score Results

For each book found:

1. **Deduplicate** — remove books already in library, reading list, or previous radar
2. **Taste match** — score alignment with the taste profile (themes, authors, style)
3. **Trend signal** — how many sources mention it? Is it on multiple lists? Award-nominated?
4. **Freshness** — is it new (2025-2026), or a backlist title trending again?
5. **Category tag** — which radar category caught it?

**Scoring heuristic:**
- 🟢 **Strong match** — aligns with 2+ taste themes AND appears in 2+ trend sources
- 🟡 **Worth watching** — aligns with taste OR has strong trend signal, but not both
- 🔵 **Wildcard** — high trend signal but outside usual taste (potential growth edge)

#### Step 4: Update the Radar Document

Write `lists/trend-radar.md` using this template:

```markdown
# Trend Radar

**Last Swept:** YYYY-MM-DD
**Sweep Frequency:** monthly (recommended)

## 🔥 Hot Now

Books trending across multiple sources right now.

| Book | Author | Why Trending | Taste Match | Source |
|------|--------|-------------|-------------|--------|
| <Title> | <Author> | <award/buzz/reason> | 🟢/🟡/🔵 | <where found> |

## 📡 On My Radar

Books aligned with my taste profile that are gaining attention.

| Book | Author | Connects To | Trend Signal | Why Interesting |
|------|--------|-------------|-------------|----------------|
| <Title> | <Author> | <taste theme> | ⭐⭐⭐/⭐⭐/⭐ | <brief hook> |

## 👀 Author Watch

New or upcoming releases from favorite and adjacent authors.

| Author | Book | Status | Expected/Released |
|--------|------|--------|-------------------|
| <Author> | <Title> | announced / pre-order / just released | YYYY-MM-DD |

## 🏆 Award Tracker

Current award season highlights relevant to taste.

| Award | Category | Nominees / Winner | Taste Match |
|-------|----------|-------------------|-------------|
| <Award name> | <category> | <books> | 🟢/🟡/🔵 |

## 🌱 Emerging Topics

New themes and topics gaining traction in the book world that connect to my interests.

- **<Topic>** — <what's happening, which books represent it, why it connects to taste>

## 📊 Trend Shifts

Changes since last sweep (if previous radar exists):

- **↑ Rising**: <books or topics gaining momentum>
- **↓ Fading**: <books or topics losing buzz>
- **🆕 New this sweep**: <what appeared for the first time>
- **📌 Persistent**: <still trending from last sweep>

## ❌ Already Known

Books found in this sweep that are already in my library or reading list (skipped above).

| Book | Author | Where It Lives |
|------|--------|---------------|
| <Title> | <Author> | library / reading list |

## Sweep Log

| Date | Sources Queried | Books Found | New to Radar | Added to List |
|------|----------------|-------------|-------------|---------------|
| YYYY-MM-DD | <number> searches | <total> | <new> | <added> |
```

#### Step 5: Present Highlights

Show the user a concise summary:
- Top 3-5 **hot now** picks with taste match
- Any **author watch** news (new books from favorites)
- **Emerging topics** to be aware of
- Offer to add interesting picks to the reading list

### B. Quick Trend Check

Lightweight version — user just wants a quick answer.

1. Run 2-3 targeted searches based on the user's question
2. Filter against taste profile and reading list
3. Present 3-5 results with brief context
4. Offer to add to reading list or do a full sweep later

### C. Topic Trend Dive

User asks about trends in a specific topic.

1. Search: "best new books about <topic> 2026", "trending <topic> books"
2. Cross-reference with taste profile for personalized ranking
3. Present as a mini-radar for that topic
4. Add notable finds to the main radar document under "Emerging Topics"

### D. Periodic Refresh

When the user says "refresh my radar" or "update trends":

1. Read the previous `lists/trend-radar.md`
2. Run a full sweep (Workflow A)
3. Highlight what changed since last sweep
4. Clean up entries older than 6 months (move to archive section)

## Integration Points

### Cross-References with Other Skills

- **`taste-profile`** — the radar reads the taste profile to score and filter trends. If a trending book doesn't match taste, it's still noted (as 🔵 Wildcard) but deprioritized. When a trending topic is repeatedly surfacing, suggest adding it to the taste profile.
- **`reading-list`** — radar recommendations flow into the reading list. Always offer "add to reading list" for any radar hit. The radar also deduplicates against the reading list.
- **`book-context`** — when a trending book is by a new or unfamiliar author, offer to pull author background before committing to read.
- **`book-outline`** — if a radar book gets added to the library, generate an outline to validate it matches expectations.
- **`deep-dive`** — when an emerging topic on the radar sparks interest, offer a deep dive into that topic (possibly across existing library books + web sources).

### Reading List Integration

The radar should feel like an **upstream feeder** to the reading list:

```
Trend Radar → "this looks interesting" → Reading List → Library → Read → Taste Profile → (improves next radar sweep)
```

## Tips

- The radar is **opinionated** — it filters through the user's taste, not just "what's popular"
- Balance **taste-matched** (🟢) picks with **adjacent** (🟡) and **wildcard** (🔵) to avoid echo chambers
- The "Emerging Topics" section is where the user discovers new interests — treat it as a growth area
- Don't overwhelm — a sweep should surface 10-20 books max, not 100
- When the user says "what's new?", default to Quick Trend Check (Workflow B), not a full sweep
- Award seasons (fall/winter) and best-of season (December) are high-value sweep times
- The sweep log helps track how well the radar is performing over time
- If the user has niche interests (e.g., "civilizational collapse"), the radar should actively search those niches, not just broad bestsellers
