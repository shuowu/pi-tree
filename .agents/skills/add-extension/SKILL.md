---
name: add-extension
description: >
  Scaffold a new extension for the user's pi-tree instance.
  Invoke when the user asks to "add an extension", "create an extension",
  "new extension", "add a tool", "create a custom tool", or similar.
---

# Add Extension

Create a new extension for the user's pi-tree setup.

## Where Extensions Live

- **Core extensions** (repo): `packages/plugin-*/` — `plugin-book`, `plugin-news`, `plugin-paper`, `plugin-mcp`. These ship with the product. Don't add extensions here.
- **User extensions** (filesystem): `$DATA_PATH/extensions/` (default: `~/.local/share/pi-tree/extensions/`). This is where new extensions go. They load at startup and can override core extensions by name.

## Gather Information

Ask the user for:
1. **Extension name** — kebab-case identifier (e.g. `translation`, `citation-helper`)
2. **Purpose** — what tools the extension provides
3. **Type** — does it need pi-tree services (sources, sessions, users) or is it standalone?
   - **Standalone**: pure Pi SDK extension (HTTP APIs, file operations, etc.) — works in pi CLI too
   - **Pi-tree**: needs access to pi-tree data (sources, sessions, users) — uses `definePiTreeExtension`
4. **Source type** — which source types should this extension be available for? (book, news, paper, all)

## Create the Extension

### Standalone Extension (no pi-tree services)

Create `<DATA_PATH>/extensions/<name>/index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "<tool_name>",
    label: "<Tool Label>",
    description: "<What this tool does. Be specific — the AI uses this to decide when to call it.>",
    parameters: Type.Object({
      // Define parameters with Type.String(), Type.Number(), Type.Optional(), etc.
    }),
    async execute(_toolCallId, params) {
      // Implementation
      return {
        content: [{ type: "text", text: "result" }],
        details: undefined,
      };
    },
  });
}
```

### Pi-tree Extension (with services)

Create `<DATA_PATH>/extensions/<name>/index.ts`:

```typescript
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
import { Type } from "typebox";

export default definePiTreeExtension((pi, services) => {
  // services.sources — list, get sources
  // services.sessions — list, create sessions
  // services.users — get, ensureExists users
  // services.dataPath — path to mutable data directory
  // services.getPluginDataDir("my-plugin") — RSS operations (if available)
  // services.db() — raw Drizzle DB (power users)

  pi.registerTool({
    name: "<tool_name>",
    label: "<Tool Label>",
    description: "<What this tool does.>",
    parameters: Type.Object({
      // Define parameters
    }),
    async execute(_toolCallId, params) {
      // Use typed services:
      // const books = services.sources.list({ type: "book" });
      // const sessions = services.sessions.listForSource(userId, sourceId);
      return {
        content: [{ type: "text", text: "result" }],
        details: undefined,
      };
    },
  });
});
```

For pi-tree extensions, the user also needs to install the extension-api package.
Create `<DATA_PATH>/extensions/<name>/package.json`:

```json
{
  "name": "<name>",
  "private": true,
  "dependencies": {
    "@pi-tree/plugin-sdk": "*"
  }
}
```

Then run:
```bash
cd <DATA_PATH>/extensions/<name> && npm install
```

## Wire Up via Profile

Extensions are loaded per-session via profile YAML. Create `<DATA_PATH>/profiles/<name>.yml`:

```yaml
name: <source_type>.<mode_name>
label: <Human-readable label>
description: <One-line description>
source_type: <book|news|paper>  # omit to show for all source types
skills: [interactive-reading]   # which skills to load
extensions: [<name>, mcp]       # include your extension + mcp for web search
exclude_tools: [bash, edit]
```

If the extension should be available in an **existing** mode instead of a new one, tell the user to create a session with `context: { extensions: ["<name>", "mcp"] }` via the API, or override an existing profile.

## Conventions

1. **Tool names** — use `snake_case`, be specific (e.g. `translate_text`, not `translate`)
2. **Descriptions are critical** — the AI uses them to decide when to call tools. Be specific about what the tool does, what inputs it expects, and what it returns.
3. **Error handling** — wrap execute body in try/catch, throw descriptive Error messages
4. **Parameters** — use `Type.Optional()` for non-required params. Use `description` on each param.
5. **Multiple tools** — one extension can register multiple tools. Group related tools together.
6. **Pi SDK hooks** — extensions can also use `pi.on("session_start", ...)`, `pi.on("tool_call", ...)`, etc. for advanced behavior.

## Verify

After creating the extension:

1. Check the file exists:
   ```bash
   ls <DATA_PATH>/extensions/<name>/index.ts
   ```

2. If a profile was created, verify YAML syntax:
   ```bash
   cat <DATA_PATH>/profiles/<name>.yml
   ```

3. Remind the user: the extension loads on next session creation — no server restart needed for new sessions (existing sessions keep their original extensions).
