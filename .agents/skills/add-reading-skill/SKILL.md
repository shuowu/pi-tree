---
name: add-reading-skill
description: >
  Scaffold a new reading skill for the user's pi-tree instance.
  Invoke when the user asks to "add a skill", "create a new reading skill",
  "new skill", or similar.
---

# Add Reading Skill

Create a new reading skill for the user's pi-tree setup.

## Where Skills Live

- **Core skills** (repo): `packages/server/src/agents/skills/` — only `interactive-reading`, `book-outline`, `book-analysis`, `news-reading`, `session-router`. These are code-dependent and ship with the product. Don't add skills here unless they're used by server code.
- **User skills** (filesystem): `$DATA_PATH/skills/` (default: `~/.local/share/pi-tree/skills/`). This is where new skills go. They load first and can override core skills by name.

## Gather Information

Ask the user for:
1. **Skill name** — kebab-case identifier (e.g. `chapter-summary`, `socratic-reading`)
2. **Purpose** — what the skill does in one sentence
3. **When to use** — what user intent triggers this skill

## Create the Skill

Create `<DATA_PATH>/skills/<skill-name>/SKILL.md` with this structure:

```markdown
---
name: <skill-name>
description: "<One sentence describing what this skill does and when to use it. Include trigger phrases the AI should recognize. Be specific — the Pi SDK uses this to decide when to activate the skill.>"
---

# <Skill Title>

<One paragraph explaining the skill's purpose and approach.>

## When to Use

- <Trigger phrase or user intent>
- <Another trigger>

## Instructions

<Detailed instructions for the AI. Be specific about:>
<- What to do step by step>
<- What tone/style to use>
<- What to include/exclude in responses>
<- How to use book content (quotes, references, page numbers)>

## Examples

<Optional: show example interactions so the AI understands the expected behavior.>
```

## Conventions

Follow these conventions from existing skills:

1. **Description field is critical** — the Pi SDK resource loader uses it to decide when to activate. Include:
   - What the skill does
   - Trigger phrases (e.g. "deep dive into X", "summarize chapter")
   - What it's NOT for (to avoid false matches with other skills)

2. **Reference book content by path** — skills should tell the AI to look in `library/<bookId>/markdown/` and `library/<bookId>/analysis/` for book content.

3. **Keep instructions actionable** — tell the AI what to DO, not what the skill IS. Compare:
   - ❌ "This skill provides Socratic questioning"
   - ✅ "When discussing a concept, ask the reader what they think before explaining"

4. **Scope clearly** — each skill should handle one distinct reading activity. Don't overlap with core skills:
   - `interactive-reading` — core reading flow
   - `book-analysis` — structured analysis (summary, key-ideas, quotes)
   - `book-outline` — structural overview and navigation map

5. **Override core skills** — if the user wants to customize a core skill, create a skill with the **same name** in their skills directory. User skills load first and win on name collision (SDK first-wins dedup).

## Verify

After creating the skill, confirm it's discoverable:

1. Check the file exists:
   ```bash
   cat <DATA_PATH>/skills/<skill-name>/SKILL.md
   ```

2. Verify frontmatter is valid YAML (name + description fields present).

3. Remind the user: no server restart needed — new skills are picked up on next session creation.
