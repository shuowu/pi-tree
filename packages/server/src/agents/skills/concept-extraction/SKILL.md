---
name: concept-extraction
description: "Extract key concepts and relations from a source's outline and summary. Use when processing a new source to build the concept graph. Triggers: extract concepts, concept extraction, build concept graph."
---

# Concept Extraction

Extract structured concepts and relations from a source's analysis files and write them as JSON.

## Input

You will be told to read two files:
- `<sourceId>/analysis/outline.md` — chapter/section structure with descriptions
- `<sourceId>/analysis/summary.md` — overall source summary and key takeaways

Read both files first to understand the full scope of the source.

## What to Extract

### Concepts

Extract the **10–25 most important concepts** — ideas, theories, methods, and entities that the source discusses substantively. Each concept needs:

| Field | Description |
|---|---|
| `term` | Canonical name (title case, concise — 1–3 words) |
| `description` | One short sentence defining it as this source uses it |
| `chapter` | Chapter or section where it first appears |

**Guidelines:**
- **Be selective** — only concepts the source devotes real discussion to, not passing mentions
- **Use the base concept as the term** — strip qualifiers like "AI-Assisted", "AI-Augmented", "AI-Powered", "Generative", etc. The term should be the underlying discipline or method. The description captures how this source applies it.
  - ✅ "UX Research" — not "AI-Assisted UX Research"
  - ✅ "Prototyping" — not "AI Prototyping"
  - ✅ "Design Thinking" — not "AI-Augmented Design Thinking"
  - ✅ "Usability Testing" — not "Simulated User Testing"
- **Avoid metaphors** as terms. Extract the underlying concept instead.
- **Keep descriptions short** — under 20 words. The tool provides detail on demand; this is just a reference.
- Use **title case** (e.g. "Self-Attention", "Gradient Descent")

### Relations

Extract **intra-source relations** — how concepts within this source relate to each other:

| Field | Description |
|---|---|
| `from` | Source concept term (must match a term in the concepts array) |
| `to` | Target concept term (must match a term in the concepts array) |
| `relation` | One of: `uses`, `extends`, `contradicts`, `prerequisite_for`, `part_of`, `causes` |

**Directionality:**
- `part_of`: `from` is a part of `to`. "Backpropagation" → "Neural Networks"
- `extends`: `from` builds on `to`. "Transformer" → "Attention Mechanism"
- `uses`: `from` relies on `to`. "Reinforcement Learning" → "Reward Function"
- `prerequisite_for`: `from` must be understood before `to`
- `causes`: use sparingly — only clear causal relationships
- `contradicts`: opposing views

Only include relations clearly supported by the source. Quality over quantity.

## Existing Concepts (Normalization)

Your message may include an **EXISTING CONCEPTS** block listing concept terms already extracted from other sources in the library. When you encounter a concept that matches an existing term:

- **Reuse the exact existing term** — do not create a synonym or variant
- Example: if "Gradient Descent" exists and this source discusses the same concept, use "Gradient Descent" exactly, not "Gradient-Based Optimization"
- Only reuse when the concepts genuinely refer to the same thing

## Output

Write a single JSON file to the path specified in your instructions (typically `<sourceId>/analysis/concepts.json`).

The file must contain ONLY valid JSON — no markdown fences, no commentary, no explanation:

```json
{
  "version": 1,
  "concepts": [
    {
      "term": "Self-Attention",
      "description": "Computes relationships between all sequence positions for context-aware representations.",
      "chapter": "Chapter 3: The Transformer"
    }
  ],
  "relations": [
    { "from": "Self-Attention", "to": "Multi-Head Attention", "relation": "part_of" }
  ]
}
```

## Workflow

1. **Read** `outline.md` and `summary.md` for the source
2. **Identify** the 10–25 most important concepts
3. **Check** the existing concepts block (if provided) and reuse matching terms
4. **Identify** relations between the extracted concepts
5. **Write** the JSON file — output ONLY valid JSON, nothing else
