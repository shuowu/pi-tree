/**
 * DictionaryService — standalone dictionary lookup and glossary management.
 *
 * Fully independent from reading sessions. Uses in-memory Pi SDK sessions
 * for AI lookups and direct DB access for glossary CRUD.
 */

import { join, dirname } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { eq, and, desc } from "drizzle-orm";
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { getServerConfig } from "../config.js";
import { configureModelRegistry } from "@pi-tree/core";
import { getDb, users, glossaryEntries } from "../db/index.js";
import { DEFAULT_CONFIG } from "@pi-tree/shared";

// Singleton instance
let _instance: DictionaryService | null = null;

export class DictionaryService {
  private constructor() {}

  static getInstance(): DictionaryService {
    if (!_instance) {
      _instance = new DictionaryService();
    }
    return _instance;
  }

  // ---------------------------------------------------------------------------
  // AI Lookup
  // ---------------------------------------------------------------------------

  /**
   * Create a fresh in-memory AgentSession for a single lookup.
   * No JSONL file, no session pollution.
   */
  private async createLookupAgent(): Promise<AgentSession> {
    const serverConfig = getServerConfig();
    const repoRoot = join(import.meta.dirname, "../../../..");

    const { authStorage, modelRegistry, selectedModel } = configureModelRegistry({
      ...serverConfig,
      readingModel: serverConfig.lookupModel || serverConfig.readingModel,
    });

    const { session } = await createAgentSession({
      cwd: repoRoot,
      tools: [],
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      ...(selectedModel ? { model: selectedModel } : {}),
    });

    return session;
  }

  /**
   * Stream a dictionary lookup. Creates a fresh in-memory session,
   * sends the prompt, streams tokens, then disposes the session.
   */
  async streamLookup(
    term: string,
    opts: {
      sourceId?: string;
      context?: string;
      onToken: (token: string) => Promise<void>;
    },
  ): Promise<string> {
    const template = this.resolveLookupPrompt(opts.sourceId);
    const sourceTitle = opts.sourceId?.replace(/_/g, " ") ?? "";
    const prompt = this.renderLookupTemplate(template, {
      term,
      context: opts.context,
      bookTitle: sourceTitle,
    });

    let agent: AgentSession | null = null;
    try {
      agent = await this.createLookupAgent();
      let fullResponse = "";

      const unsubscribe = agent.subscribe(
        async (event: AgentSessionEvent) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta"
          ) {
            const delta = event.assistantMessageEvent.delta ?? "";
            fullResponse += delta;
            await opts.onToken(delta);
          }
        },
      );

      try {
        await agent.prompt(prompt);
      } finally {
        unsubscribe();
      }

      return fullResponse;
    } finally {
      agent?.dispose();
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt template resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the lookup prompt template with file-based override support.
   *
   * Resolution order (first found wins):
   *   1. Per-book user override:  DATA_PATH/books/<bookId>/dictionary-prompt.md
   *   2. Global user override:    DATA_PATH/dictionary-prompt.md
   *   3. Project default:         packages/server/src/agents/prompts/dictionary-prompt.md
   *   4. Compiled-in fallback:    minimal inline string (last resort)
   */
  private resolveLookupPrompt(sourceId?: string): string {
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");

    // Per-book user override
    if (sourceId) {
      const sourcePromptPath = join(dataPath, "books", sourceId, "dictionary-prompt.md");
      const loaded = this.tryReadPromptFile(sourcePromptPath);
      if (loaded) return loaded;
    }

    // Global user override
    const globalPromptPath = join(dataPath, "dictionary-prompt.md");
    const globalLoaded = this.tryReadPromptFile(globalPromptPath);
    if (globalLoaded) return globalLoaded;

    // Project default (shipped with the repo)
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const projectPromptPath = join(thisDir, "..", "agents", "prompts", "dictionary-prompt.md");
    const projectLoaded = this.tryReadPromptFile(projectPromptPath);
    if (projectLoaded) return projectLoaded;

    // Compiled-in fallback
    return DEFAULT_CONFIG.lookup.promptTemplate;
  }

  private tryReadPromptFile(path: string): string | null {
    if (!existsSync(path)) return null;
    try {
      const content = readFileSync(path, "utf-8").trim();
      return content || null;
    } catch {
      return null;
    }
  }

  /**
   * Render a lookup prompt template with Mustache-style placeholders.
   */
  private renderLookupTemplate(
    template: string,
    vars: { term: string; context?: string; bookTitle: string },
  ): string {
    let result = template;

    // Handle conditional blocks: {{#context}}...{{/context}}
    if (vars.context) {
      result = result.replace(/\{\{#context\}\}([\s\S]*?)\{\{\/context\}\}/g, "$1");
    } else {
      result = result.replace(/\{\{#context\}\}[\s\S]*?\{\{\/context\}\}/g, "");
    }

    // Replace simple placeholders
    result = result
      .replace(/\{\{term\}\}/g, vars.term)
      .replace(/\{\{context\}\}/g, vars.context ?? "")
      .replace(/\{\{bookTitle\}\}/g, vars.bookTitle);

    // Clean up blank lines from removed conditional blocks
    result = result.replace(/\n{3,}/g, "\n\n").trim();

    return result;
  }

  /**
   * Get the effective lookup prompt and its resolution source.
   */
  getLookupPrompt(sourceId?: string): {
    template: string;
    source: 'source' | 'global' | 'project' | 'fallback';
    isCustom: boolean;
    defaultTemplate: string;
  } {
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");
    const thisDir = dirname(fileURLToPath(import.meta.url));

    // Get the project default first (for returning as defaultTemplate)
    const projectPromptPath = join(thisDir, "..", "agents", "prompts", "dictionary-prompt.md");
    const projectDefault = this.tryReadPromptFile(projectPromptPath) ?? DEFAULT_CONFIG.lookup.promptTemplate;

    // Check per-source override
    if (sourceId) {
      const sourcePromptPath = join(dataPath, "books", sourceId, "dictionary-prompt.md");
      const loaded = this.tryReadPromptFile(sourcePromptPath);
      if (loaded) return { template: loaded, source: 'source', isCustom: true, defaultTemplate: projectDefault };
    }

    // Check global override
    const globalPromptPath = join(dataPath, "dictionary-prompt.md");
    const globalLoaded = this.tryReadPromptFile(globalPromptPath);
    if (globalLoaded) return { template: globalLoaded, source: 'global', isCustom: true, defaultTemplate: projectDefault };

    // Project default
    return { template: projectDefault, source: 'project', isCustom: false, defaultTemplate: projectDefault };
  }

  /**
   * Save a custom lookup prompt template.
   * scope: 'global' → DATA_PATH/dictionary-prompt.md
   * scope: 'source' → DATA_PATH/books/<sourceId>/dictionary-prompt.md
   * Pass null/empty template to delete the override (revert to default).
   */
  saveLookupPrompt(scope: 'global' | 'source', template: string | null, sourceId?: string): void {
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");

    let targetPath: string;
    if (scope === 'source') {
      if (!sourceId) throw new Error('sourceId is required for source-scoped prompt');
      targetPath = join(dataPath, "books", sourceId, "dictionary-prompt.md");
    } else {
      targetPath = join(dataPath, "dictionary-prompt.md");
    }

    if (!template || !template.trim()) {
      // Delete the override file if it exists
      if (existsSync(targetPath)) {
        unlinkSync(targetPath);
      }
      return;
    }

    // Ensure directory exists
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(targetPath, template, 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Glossary persistence — direct DB operations
  // ---------------------------------------------------------------------------

  /**
   * Ensure a user row exists (auto-create for backward compatibility).
   */
  private async ensureUser(userId: string): Promise<void> {
    const db = await getDb();
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!existing) {
      const now = new Date().toISOString();
      await db.insert(users)
        .values({
          id: userId,
          displayName: userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  async saveGlossaryEntry(
    userId: string,
    sourceId: string,
    term: string,
    definition?: string,
  ): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    await this.ensureUser(userId);

    await db.insert(glossaryEntries)
      .values({
        userId,
        sourceId,
        term,
        definition: definition ?? null,
        createdAt: now,
      })
      .run();
  }

  async getGlossaryEntries(
    userId: string,
    sourceId: string,
  ): Promise<Array<{
    id: number;
    term: string;
    definition: string | null;
    createdAt: string;
  }>> {
    const db = await getDb();
    return await db
      .select()
      .from(glossaryEntries)
      .where(
        and(
          eq(glossaryEntries.userId, userId),
          eq(glossaryEntries.sourceId, sourceId),
        ),
      )
      .orderBy(desc(glossaryEntries.createdAt))
      .all();
  }

  async deleteGlossaryEntry(userId: string, entryId: number): Promise<void> {
    const db = await getDb();
    await db.delete(glossaryEntries)
      .where(
        and(
          eq(glossaryEntries.id, entryId),
          eq(glossaryEntries.userId, userId),
        ),
      )
      .run();
  }
}
