/**
 * DictionaryService — standalone dictionary lookup and glossary management.
 *
 * Fully independent from reading sessions. Uses in-memory Pi SDK sessions
 * for AI lookups and direct DB access for glossary CRUD.
 */

import { join, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
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
import { getDb, users, glossaryEntries } from "../db/index.js";
import { DEFAULT_CONFIG } from "@pi-reader/shared";

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

    // Auth
    let authStorage: AuthStorage;
    if (serverConfig.apiKey && serverConfig.provider) {
      authStorage = AuthStorage.inMemory();
      authStorage.setRuntimeApiKey(serverConfig.provider, serverConfig.apiKey);
    } else {
      authStorage = AuthStorage.create();
    }

    const modelRegistry = ModelRegistry.create(authStorage);

    if (serverConfig.apiKey && serverConfig.provider && serverConfig.baseUrl) {
      modelRegistry.registerProvider(serverConfig.provider, {
        baseUrl: serverConfig.baseUrl,
      });
    }

    // Use lookupModel (PI_LOOKUP_MODEL) instead of readingModel
    const modelId = serverConfig.lookupModel;
    const allModels = modelRegistry.getAll();
    const selectedModel = allModels.find((m) => m.id === modelId);

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
      bookId?: string;
      context?: string;
      onToken: (token: string) => Promise<void>;
    },
  ): Promise<string> {
    const template = this.resolveLookupPrompt(opts.bookId);
    const bookTitle = opts.bookId?.replace(/_/g, " ") ?? "";
    const prompt = this.renderLookupTemplate(template, {
      term,
      context: opts.context,
      bookTitle,
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
   *   3. Project default:         packages/server/prompts/dictionary-prompt.md
   *   4. Compiled-in fallback:    minimal inline string (last resort)
   */
  private resolveLookupPrompt(bookId?: string): string {
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-reader");

    // Per-book user override
    if (bookId) {
      const bookPromptPath = join(dataPath, "books", bookId, "dictionary-prompt.md");
      const loaded = this.tryReadPromptFile(bookPromptPath);
      if (loaded) return loaded;
    }

    // Global user override
    const globalPromptPath = join(dataPath, "dictionary-prompt.md");
    const globalLoaded = this.tryReadPromptFile(globalPromptPath);
    if (globalLoaded) return globalLoaded;

    // Project default (shipped with the repo)
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const projectPromptPath = join(thisDir, "..", "..", "prompts", "dictionary-prompt.md");
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

  // ---------------------------------------------------------------------------
  // Glossary persistence — direct DB operations
  // ---------------------------------------------------------------------------

  /**
   * Ensure a user row exists (auto-create for backward compatibility).
   */
  private ensureUser(userId: string): void {
    const db = getDb();
    const existing = db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!existing) {
      const now = new Date().toISOString();
      db.insert(users)
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
    bookId: string,
    term: string,
    definition?: string,
  ): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    this.ensureUser(userId);

    db.insert(glossaryEntries)
      .values({
        userId,
        bookId,
        term,
        definition: definition ?? null,
        createdAt: now,
      })
      .run();
  }

  getGlossaryEntries(
    userId: string,
    bookId: string,
  ): Array<{
    id: number;
    term: string;
    definition: string | null;
    createdAt: string;
  }> {
    const db = getDb();
    return db
      .select()
      .from(glossaryEntries)
      .where(
        and(
          eq(glossaryEntries.userId, userId),
          eq(glossaryEntries.bookId, bookId),
        ),
      )
      .orderBy(desc(glossaryEntries.createdAt))
      .all();
  }

  deleteGlossaryEntry(userId: string, entryId: number): void {
    const db = getDb();
    db.delete(glossaryEntries)
      .where(
        and(
          eq(glossaryEntries.id, entryId),
          eq(glossaryEntries.userId, userId),
        ),
      )
      .run();
  }
}
