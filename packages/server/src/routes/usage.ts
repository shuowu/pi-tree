/**
 * Usage routes — token consumption tracking and analytics.
 *
 * Provides per-session, per-source, and per-user usage statistics.
 * Includes session messages, router chat, and dictionary lookups.
 * Mounted at `/api/usage`.
 */

import { Hono } from "hono";
import { eq, and, gte, lte } from "drizzle-orm";
import { getDb, messageUsage, userSessions } from "../db/index.js";

export const usageRoutes = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Aggregate raw usage rows into a UsageStats-shaped response. */
function aggregateUsage(rows: Array<{
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  model: string;
  cost_total: number | null;
  category?: string;
}>) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let costTotal = 0;
  const byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    messageCount: number;
  }> = {};
  const byCategory: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    messageCount: number;
  }> = {};

  for (const row of rows) {
    inputTokens += row.input_tokens;
    outputTokens += row.output_tokens;
    cacheReadTokens += row.cache_read_tokens;
    cacheWriteTokens += row.cache_write_tokens;
    totalTokens += row.total_tokens;
    costTotal += row.cost_total ?? 0;

    if (!byModel[row.model]) {
      byModel[row.model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0 };
    }
    byModel[row.model].inputTokens += row.input_tokens;
    byModel[row.model].outputTokens += row.output_tokens;
    byModel[row.model].totalTokens += row.total_tokens;
    byModel[row.model].messageCount += 1;

    const cat = row.category ?? "session";
    if (!byCategory[cat]) {
      byCategory[cat] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, messageCount: 0 };
    }
    byCategory[cat].inputTokens += row.input_tokens;
    byCategory[cat].outputTokens += row.output_tokens;
    byCategory[cat].totalTokens += row.total_tokens;
    byCategory[cat].messageCount += 1;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costTotal: costTotal || undefined,
    messageCount: rows.length,
    byModel,
    byCategory,
  };
}

/** Common select columns for usage queries. */
const usageColumns = {
  input_tokens: messageUsage.inputTokens,
  output_tokens: messageUsage.outputTokens,
  cache_read_tokens: messageUsage.cacheReadTokens,
  cache_write_tokens: messageUsage.cacheWriteTokens,
  total_tokens: messageUsage.totalTokens,
  model: messageUsage.model,
  cost_total: messageUsage.costTotal,
  category: messageUsage.category,
} as const;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Get usage for a specific session */
usageRoutes.get("/session/:sessionId", async (c) => {
  const sessionId = Number(c.req.param("sessionId"));
  if (!Number.isFinite(sessionId)) return c.json({ error: "Invalid session ID" }, 400);

  const db = await getDb();
  const rows = await db
    .select(usageColumns)
    .from(messageUsage)
    .where(eq(messageUsage.sessionId, sessionId))
    .all();
  return c.json(aggregateUsage(rows));
});

/** Get usage for a user across all sources (supports ?from= and ?to= date filters) */
usageRoutes.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const db = await getDb();

  // Query directly by userId column — includes session, router, and lookup usage
  const whereConditions = [eq(messageUsage.userId, userId)];
  if (from) whereConditions.push(gte(messageUsage.createdAt, from));
  if (to) whereConditions.push(lte(messageUsage.createdAt, to));

  const rows = await db
    .select(usageColumns)
    .from(messageUsage)
    .where(and(...whereConditions))
    .all();
  return c.json(aggregateUsage(rows));
});

/** Get usage for a user+source (supports ?from= and ?to= date filters) */
usageRoutes.get("/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const db = await getDb();
  // Source-scoped queries still need the session join (source is on userSessions)
  const whereConditions = [
    eq(userSessions.userId, userId),
    eq(userSessions.sourceId, sourceId),
  ];
  if (from) whereConditions.push(gte(messageUsage.createdAt, from));
  if (to) whereConditions.push(lte(messageUsage.createdAt, to));

  const rows = await db
    .select(usageColumns)
    .from(messageUsage)
    .innerJoin(userSessions, eq(messageUsage.sessionId, userSessions.id))
    .where(and(...whereConditions))
    .all();
  return c.json(aggregateUsage(rows));
});
