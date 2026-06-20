---
title: Examples
description: Example extensions, skills, and session profiles you can copy into your pi-tree instance.
---

# Examples

Pi-tree is extensible through [custom skills](/docs/self-hosting#custom-skills), [extensions](/docs/self-hosting#custom-extensions), and [session profiles](/docs/self-hosting#custom-session-profiles). The `examples/` directory in the repo contains ready-to-use examples you can copy into your data path.

## GitHub Explorer

**[`examples/github-explorer/`](https://github.com/shuowu/pi-tree/tree/master/examples/github-explorer)**

Clone GitHub repositories and explore codebases conversationally. The AI clones a repo locally, then uses its built-in file tools (`read`, `grep`, `find`, `ls`) to walk through the code with you.

### What's inside

| File | Purpose |
|------|---------|
| `extensions/github/index.ts` | `clone_repo` and `list_repos` tools |
| `skills/github-reading/SKILL.md` | Instructions for structured codebase exploration |
| `profiles/github-reading.yml` | Session profile wiring skill + extension |

### Quick setup

```bash
DATA_PATH="${DATA_PATH:-$HOME/.local/share/pi-tree}"

cp -r examples/github-explorer/extensions/github   "$DATA_PATH/extensions/"
cp -r examples/github-explorer/skills/github-reading "$DATA_PATH/skills/"
cp -r examples/github-explorer/profiles/github-reading.yml "$DATA_PATH/profiles/"
```

Restart the server, then create a session with the **"GitHub Explorer"** mode.

### How it works

The extension is intentionally minimal — just two tools:

- **`clone_repo(repo)`** — Runs `git clone` to `$DATA_PATH/repos/<owner>/<repo>/`
- **`list_repos()`** — Lists what's already cloned

All codebase exploration is handled by Pi's built-in tools. The skill teaches the AI how to do a structured walkthrough: start with the README, scan the directory layout, then follow the user's questions with `grep` and `read`.

:::tip
This pattern — a thin extension for setup + Pi's built-in tools for exploration — works for many use cases. You could adapt it for local documentation folders, research paper collections, or any file-based content.
:::

## Creating Your Own

Every custom flow needs up to three pieces:

### 1. Extension (tools)

Create `$DATA_PATH/extensions/<name>/index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "What this tool does",
    parameters: Type.Object({
      input: Type.String({ description: "Input parameter" }),
    }),
    async execute(_toolCallId, params) {
      // Your logic — fetch APIs, run commands, read files, etc.
      return {
        content: [{ type: "text", text: `Result: ${params.input}` }],
        details: undefined,
      };
    },
  });
}
```

Extensions are loaded at runtime via [jiti](https://github.com/unjs/jiti) — no build step needed. They can use any Node.js built-in module and have access to dependencies bundled with pi-tree (`typebox`, etc.).

### 2. Skill (AI instructions)

Create `$DATA_PATH/skills/<name>/SKILL.md`:

```markdown
---
name: my-skill
description: One-line summary of what this skill does
---

# My Skill

Detailed instructions for the AI...
```

Skills are re-read from disk each session, so changes take effect immediately — no restart needed.

### 3. Profile (wiring)

Create `$DATA_PATH/profiles/<name>.yml`:

```yaml
name: my-source.my-mode
label: My Custom Mode
description: What this mode does
source_type: book          # optional — limits to this source type

skills:
  - my-skill

extensions:
  - my-extension

exclude_tools: [bash, edit]
```

See [Custom Session Profiles](/docs/self-hosting#custom-session-profiles) for all available fields.

:::info
Extensions require a server restart to pick up. Skills and profiles are discovered at startup but skill content is re-read each session.
:::
