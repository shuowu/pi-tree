# CLAUDE.md

Guidance for working in the pi-tree repo.

## Databases: prod vs dev — read before touching any data

The Docker deployment (UI at :3847) and its NAS sqld databases are
**production for personal use** and must stay stable. All development,
testing, and verification uses local data (`.local-data/` for dev servers,
`packages/server/.test-data/` for tests).

⚠️ The repo `.env` (direnv-exported into every shell) contains
`PI_TREE_DB_URL`, `PI_TREE_NEWS_DB_URL`, and `RSS_REMOTE_URL` pointing at the
NAS. The `dev` and `test` scripts in `packages/server` blank these inline —
keep those guards. Any *ad-hoc* command that can touch the DB (vitest with a
filter, tsx one-offs, scripts) must do the same:

```bash
PI_TREE_DB_URL='' PI_TREE_NEWS_DB_URL='' RSS_REMOTE_URL='' npx vitest run <filter>
```

Never write to the NAS databases without the user's explicit approval.

## Writing skills

Skills are the `SKILL.md` playbooks that drive each reading session
(`packages/plugin-*/skills/<name>/SKILL.md`). A profile
(`packages/plugin-*/profiles/*.yml`) binds a skill to a `source_type`/mode,
plus its `extensions` and `exclude_tools`. Skill files are read from disk at
each session start.

The guiding principle when authoring a skill:

> **Give the model the knowledge it lacks. Don't override the judgment it has.
> Never instruct against its actual environment.**

Concretely, split by *what kind* of instruction it is:

- **Be specific about HOW to execute** — this is the value of a skill, and the
  model can't guess it. Tool names and exact parameters, output/citation
  formats, domain conventions (e.g. arXiv `cat:cs.AI` codes), file paths,
  templates. Vague here = worse results.
- **Be goal-oriented about WHEN / WHETHER to act** — condition actions on the
  user's *observable intent*, not a fixed reflex. "Fetch the feed **when the
  user wants feed content**" ✅, not "fetch on **every** message" ❌.

### Three anti-patterns (all real bugs we've hit)

1. **Hardcoded reflex** — "on *every* message, call the RSS tools." Fires
   regardless of intent, so conceptual follow-ups got an unwanted briefing
   appended. Fix: gate the action on what the user actually asked for.
2. **Gating on unobservable state** — "at the root node do X; at branch nodes
   do Y." The agent only ever sees a **linear branch** (the path from root to
   the current leaf); the app owns the tree and never exposes topology to the
   model. So position-based instructions are unfollowable. Decide by message
   intent instead, and don't tell the model to "create branches" — it can't;
   the app auto-branches.
3. **Contradicting the environment** — instructing a tool the profile blocks
   (e.g. `grep`/bash when `exclude_tools: [bash, edit]`). Check the loading
   profile's `exclude_tools` before relying on a tool. The `read` tool already
   returns `cat -n`-style line numbers, so bash `grep -n` is rarely needed.

### Scale guardrails to model strength

This repo often runs a **local model** (LM Studio, e.g. qwen-27b). Weaker models
need *more* explicit fencing, not less: state the goal **and** call out the
common failure mode (e.g. "never append a briefing to a deep-dive reply").
A frontier model can run on looser goals.

## Iterating on skills with Docker

Skill files are read from disk at each session start and the plugin `skills/`
dirs are bind-mounted (see `docker-compose.yml`), so **skill-only edits** apply
with a restart:

```
docker compose restart pi-tree
```

Changes to compiled code (`packages/core`, `packages/server`, anything in
`dist`) still need a rebuild:

```
docker compose up -d --build
```
