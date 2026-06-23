import type { AgentTaskService } from "@pi-tree/plugin-sdk";
import { TreeManager } from "./tree-manager.js";
import { getDb, sources, userSessions, users } from "../db/index.js";
import { eq, and } from "drizzle-orm";

/**
 * Server-side implementation of AgentTaskService.
 * Creates temporary Pi sessions to run headless agent tasks.
 *
 * The flow:
 * 1. Ensure the user exists (auto-create "system" user if needed)
 * 2. Create a temporary session row in DB with the desired mode
 * 3. Use TreeManager.loadOrCreate() to resolve the profile + create PiSession
 * 4. Send the message (non-streaming) and wait for completion
 * 5. Clean up the temporary session row
 */
export class AgentTaskServiceImpl implements AgentTaskService {
  async run(opts: {
    sourceId: string;
    mode: string;
    message: string;
    userId?: string;
  }): Promise<{ response: string }> {
    const userId = opts.userId ?? "system";
    const sourceId = opts.sourceId;

    // Look up the source to get its type
    const db = getDb();
    const sourceRow = db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!sourceRow) {
      throw new Error(`[agent-task] Source '${sourceId}' not found`);
    }

    console.log(`[agent-task] Running task: source=${sourceId}, type=${sourceRow.type}, mode=${opts.mode}, user=${userId}`);

    // Ensure the user exists (auto-create "system" user if needed)
    const existingUser = db.select().from(users).where(eq(users.id, userId)).get();
    if (!existingUser) {
      db.insert(users).values({
        id: userId,
        displayName: userId === "system" ? "System" : userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
    }

    // Create a temporary session with the desired mode so TreeManager
    // resolves the correct profile (skills, extensions, model).
    const now = new Date().toISOString();
    const context = JSON.stringify({ mode: opts.mode });
    const sessionResult = db.insert(userSessions).values({
      userId,
      sourceId,
      title: `System task: ${opts.mode}`,
      sessionFile: `pending-${Date.now()}`,
      context,
      isActive: 1,
      lastActiveAt: now,
      createdAt: now,
    }).run();
    const sessionId = Number(sessionResult.lastInsertRowid);

    try {
      // Create session via TreeManager — this resolves the profile for the
      // source type + mode, configures skills/extensions, and creates the PiSession.
      const tm = await TreeManager.loadOrCreate(userId, sourceId, { sessionId });

      // Send the message and wait for completion (non-streaming)
      const result = await tm.handleMessage(opts.message);

      console.log(`[agent-task] Task completed: source=${sourceId}, mode=${opts.mode}`);
      return { response: result.response };
    } finally {
      // Clean up the temporary session — both DB row and JSONL file on disk
      const sessionRow = db.select().from(userSessions)
        .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
        .get();
      const sessionFile = sessionRow?.sessionFile;

      db.delete(userSessions)
        .where(
          and(
            eq(userSessions.id, sessionId),
            eq(userSessions.userId, userId),
          ),
        )
        .run();

      // Remove the JSONL session file if it exists
      if (sessionFile && !sessionFile.startsWith("pending-")) {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(sessionFile);
        } catch {
          // Ignore — file may not exist or already be cleaned up
        }
      }
    }
  }
}
