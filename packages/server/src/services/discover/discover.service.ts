/**
 * DiscoverService — the reading-list pipeline orchestrator.
 *
 * Generic stages (source-type-agnostic):
 *   gather local signals → build interest model → run providers → rank → present
 *
 * Only candidate generation is per-type, behind DiscoverProvider. Books ship
 * the first provider. See local-docs/READING-LIST.md.
 */

import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { eq, desc } from "drizzle-orm";
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { configureModelRegistry } from "@pi-tree/core";
import { DEFAULT_CONFIG, type ReadingListConfig } from "@pi-tree/shared";
import { getServerConfig } from "../../config.js";
import { getDb, sources, userSessions, memos } from "../../db/index.js";
import { BookDiscoverProvider } from "./providers/book-provider.js";
import { DiscoverRegistry } from "./registry.js";
import type {
  Candidate,
  DiscoverProvider,
  InterestModel,
  OwnedSource,
} from "./types.js";

/** Progress events streamed to the client during a discover run. */
export type DiscoverEvent =
  | { type: "status"; phase: string; message: string }
  | { type: "done"; candidates: Candidate[]; topics: string[]; generatedAt?: string }
  | { type: "error"; error: string };

/** A cached discover run, persisted per user. */
export interface CachedDiscover {
  candidates: Candidate[];
  topics: string[];
  generatedAt: string;
  /** The source types that produced this run (null = all). */
  sourceTypes: string[] | null;
}

/** Case-insensitive dedupe preserving first-seen order. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

let _instance: DiscoverService | null = null;

export class DiscoverService {
  /** Built-in providers; plugin-registered ones are added at run time from the registry. */
  private builtins: DiscoverProvider[] = [new BookDiscoverProvider()];

  private constructor() {}

  private get providers(): DiscoverProvider[] {
    return [...this.builtins, ...DiscoverRegistry.getInstance().all()];
  }

  /** Source types the user can target (one per registered provider). */
  availableSourceTypes(): string[] {
    return this.providers.map((p) => p.sourceType);
  }

  // -------------------------------------------------------------------------
  // Latest-run cache (per user) — so returning to Discover shows the last
  // results instantly instead of a blank page or a wasteful re-run.
  // -------------------------------------------------------------------------

  private cacheFile(userId: string): string {
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
    return join(dataPath, "discover", `${safe}.json`);
  }

  /** Return the user's most recent discover run, or null. */
  getCached(userId: string): CachedDiscover | null {
    const file = this.cacheFile(userId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as CachedDiscover;
    } catch {
      return null;
    }
  }

  private saveCache(userId: string, data: CachedDiscover): void {
    try {
      const file = this.cacheFile(userId);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data), "utf-8");
    } catch (err) {
      console.warn("[discover] failed to cache latest run:", err);
    }
  }

  static getInstance(): DiscoverService {
    if (!_instance) _instance = new DiscoverService();
    return _instance;
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  /** Merge readingList overrides from global-config.json over the defaults. */
  getConfig(): ReadingListConfig {
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");
    const configPath = join(dataPath, "global-config.json");
    let override: Partial<ReadingListConfig> = {};
    if (existsSync(configPath)) {
      try {
        const data = JSON.parse(readFileSync(configPath, "utf-8"));
        if (data.readingList && typeof data.readingList === "object") {
          override = data.readingList;
        }
      } catch {
        // fall back to defaults
      }
    }
    return { ...DEFAULT_CONFIG.readingList, ...override };
  }

  // -------------------------------------------------------------------------
  // Main entry
  // -------------------------------------------------------------------------

  async discover(
    userId: string,
    opts: { onEvent?: (e: DiscoverEvent) => Promise<void>; sourceTypes?: string[] } = {},
  ): Promise<{ candidates: Candidate[]; topics: string[] }> {
    const emit = opts.onEvent ?? (async () => {});
    const config = this.getConfig();

    if (config.mode === "off") {
      return { candidates: [], topics: [] };
    }

    await emit({ type: "status", phase: "signals", message: "Reading your library and notes…" });
    const interest = await this.buildInterestModel(userId);

    if (interest.ownedSources.length === 0) {
      await emit({ type: "done", candidates: [], topics: [] });
      return { candidates: [], topics: [] };
    }

    await emit({ type: "status", phase: "generate", message: "Searching your selected sources…" });
    const llm = this.makeLlmRunner(config.model);
    const baseCtx = {
      llm,
      allowExternalLookup: config.allowExternalLookup,
      count: config.count,
      diversity: config.diversity,
    };

    // Restrict to the user-selected source types, if any.
    const selected =
      opts.sourceTypes && opts.sourceTypes.length
        ? this.providers.filter((p) => opts.sourceTypes!.includes(p.sourceType))
        : this.providers;

    const results = await Promise.all(
      selected.map((p) =>
        p
          .getCandidates(interest, {
            ...baseCtx,
            // Each provider's steps are surfaced live, tagged with its source type.
            log: (message: string) => void emit({ type: "status", phase: p.sourceType, message }),
          })
          .catch((err) => {
            console.warn(`[discover] provider ${p.sourceType} failed:`, err);
            return [] as Candidate[];
          }),
      ),
    );

    const candidates = this.rank(results.flat());
    const generatedAt = new Date().toISOString();
    // Cache the latest non-empty run so returning to Discover is instant.
    if (candidates.length > 0) {
      this.saveCache(userId, {
        candidates,
        topics: interest.topics,
        generatedAt,
        sourceTypes: opts.sourceTypes ?? null,
      });
    }
    await emit({ type: "done", candidates, topics: interest.topics, generatedAt });
    return { candidates, topics: interest.topics };
  }

  // -------------------------------------------------------------------------
  // Signal gathering → interest model (generic, source-type-agnostic)
  // -------------------------------------------------------------------------

  private async buildInterestModel(userId: string): Promise<InterestModel> {
    const db = await getDb();
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");

    const sourceRows = await db.select().from(sources).all();

    // Which sources the user has actually opened a session on.
    const sessionRows = await db
      .select({ sourceId: userSessions.sourceId })
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .all();
    const engagedSet = new Set(sessionRows.map((r) => r.sourceId));

    const ownedSources: OwnedSource[] = [];
    const engagedConcepts: string[] = [];
    const otherConcepts: string[] = [];

    for (const s of sourceRows) {
      // Skip singleton/system sources (news, router) — they aren't "books to read next".
      if (s.type === "router") continue;
      const concepts = this.readConcepts(dataPath, s.id);
      const engaged = engagedSet.has(s.id);
      ownedSources.push({
        id: s.id,
        type: s.type,
        title: s.title,
        author: s.author ?? "",
        concepts,
        engaged,
      });
      (engaged ? engagedConcepts : otherConcepts).push(...concepts);
    }

    // Topics: concepts from engaged sources rank first, then the rest. Deduped.
    const topics = dedupe([...engagedConcepts, ...otherConcepts]).slice(0, 25);

    // Recent saved notes — strong explicit-interest signal.
    const memoRows = await db
      .select({ title: memos.title })
      .from(memos)
      .where(eq(memos.userId, userId))
      .orderBy(desc(memos.updatedAt))
      .limit(20)
      .all();
    const memoTitles = memoRows.map((m) => m.title).filter(Boolean);

    const tags = dedupe(
      sourceRows.flatMap((s) => this.parseTags(s.metadata)),
    ).slice(0, 20);

    const digest = this.composeDigest({
      topics,
      engagedTitles: ownedSources.filter((s) => s.engaged).map((s) => s.title),
      memoTitles,
      tags,
    });

    return { topics, digest, ownedSources, tags };
  }

  private readConcepts(dataPath: string, sourceId: string): string[] {
    const path = join(dataPath, "sources", sourceId, "analysis", "concepts.json");
    if (!existsSync(path)) return [];
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      const list = Array.isArray(data) ? data : data.concepts;
      if (!Array.isArray(list)) return [];
      return list
        .map((c: any) => (typeof c === "string" ? c : c?.term))
        .filter((t: unknown): t is string => typeof t === "string" && t.length > 0);
    } catch {
      return [];
    }
  }

  private parseTags(metadata: string | null): string[] {
    if (!metadata) return [];
    try {
      const m = JSON.parse(metadata);
      return Array.isArray(m?.tags) ? m.tags.filter((t: unknown) => typeof t === "string") : [];
    } catch {
      return [];
    }
  }

  private composeDigest(input: {
    topics: string[];
    engagedTitles: string[];
    memoTitles: string[];
    tags: string[];
  }): string {
    const lines: string[] = [];
    if (input.topics.length) {
      lines.push(`Concepts engaged with: ${input.topics.slice(0, 15).join(", ")}.`);
    }
    if (input.engagedTitles.length) {
      lines.push(`Books actively read: ${input.engagedTitles.slice(0, 10).join("; ")}.`);
    }
    if (input.memoTitles.length) {
      lines.push(`Notes saved: ${input.memoTitles.slice(0, 10).join("; ")}.`);
    }
    if (input.tags.length) {
      lines.push(`Tags used: ${input.tags.join(", ")}.`);
    }
    return lines.join("\n") || "(no strong signals yet)";
  }

  // -------------------------------------------------------------------------
  // Ranking (generic)
  // -------------------------------------------------------------------------

  private rank(candidates: Candidate[]): Candidate[] {
    // Shelf items first (already owned → zero friction), then by score.
    return candidates.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "shelf" ? -1 : 1;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }

  // -------------------------------------------------------------------------
  // LLM runner — fresh in-memory agent per call (mirrors DictionaryService)
  // -------------------------------------------------------------------------

  private makeLlmRunner(modelOverride?: string): (prompt: string) => Promise<string> {
    return async (prompt: string) => {
      const serverConfig = getServerConfig();
      const repoRoot = join(import.meta.dirname, "../../../../..");
      const { authStorage, modelRegistry, selectedModel } = configureModelRegistry({
        ...serverConfig,
        readingModel: modelOverride || serverConfig.readingModel,
      });

      const { session } = await createAgentSession({
        cwd: repoRoot,
        tools: [],
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        ...(selectedModel ? { model: selectedModel } : {}),
      });

      let full = "";
      const unsubscribe = (session as AgentSession).subscribe(async (event: AgentSessionEvent) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          full += event.assistantMessageEvent.delta ?? "";
        }
      });
      try {
        await session.prompt(prompt);
      } finally {
        unsubscribe();
        session.dispose();
      }
      return full;
    };
  }
}
