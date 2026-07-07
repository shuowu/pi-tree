/**
 * Intent classifier for the home-page router.
 *
 * A single constrained LLM call that maps a natural-language message to one
 * routing label — a registered destination id (e.g. "discover") or "none".
 * This is cross-language (the model judges meaning in any language) and far more
 * reliable than hoping the conversational router agent picks the right tool: the
 * output space is a fixed label set with multilingual few-shot examples.
 *
 * Used by /route for messages with no @mentions. On "none" it falls through to
 * the full LLM router (source browsing/opening). Uses the fast lookup model.
 */

import { join } from "node:path";
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { configureModelRegistry } from "@pi-tree/core";
import { getServerConfig } from "../config.js";
import { RouterDestinationRegistry } from "./destination-registry.js";

export interface IntentResult {
  /** Registered destination id, or null (= "none"). */
  destination: string | null;
  /** Content types the user named, canonicalized to discover source types (book/paper/news). */
  sourceTypes: string[];
}

/**
 * Classify a message to a registered destination (+ any content types named).
 * Never throws — returns { destination: null } on failure so routing falls through.
 */
export async function classifyIntent(message: string): Promise<IntentResult> {
  const destinations = RouterDestinationRegistry.getInstance().all();
  if (destinations.length === 0 || !message.trim()) return { destination: null, sourceTypes: [] };

  const ids = destinations.map((d) => d.id);
  const labelDocs = destinations.map((d) => `- ${d.id}: ${d.description}`).join("\n");

  const prompt = [
    "You are an intent classifier for a reading app's home screen. Map the user's message to ONE routing label, and note any content types they named.",
    "",
    "Destination labels:",
    labelDocs,
    "- none: anything else — opening or continuing a SPECIFIC source they already have, questions, greetings, or unclear intent.",
    "",
    "Content types (only if the user named one): book, paper, feed.",
    "",
    "Rules:",
    "- Judge by MEANING, in ANY language.",
    "- Pick a destination label ONLY when the user clearly wants what it describes.",
    "- When in doubt, pick none.",
    "- Reply with the label word. If the user named content types, add them after a space (e.g. 'discover book').",
    "",
    "Examples:",
    '"suggest new books" -> discover book',
    '"recommend some papers" -> discover paper',
    '"any good feeds to follow?" -> discover feed',
    '"推荐几本新书" -> discover book',
    '"what should I read next?" -> discover',
    '"algo nuevo para leer?" -> discover',
    '"open atomic habits" -> none',
    '"what is stoicism" -> none',
    '"hello" -> none',
    "",
    `Message: ${JSON.stringify(message)}`,
    "Answer:",
  ].join("\n");

  try {
    const raw = await runClassifier(prompt);
    const lower = raw.toLowerCase();
    // Robust to models that emit reasoning/extra text: pick the LATEST-occurring
    // destination id (models put the final answer last). If "none" appears after
    // any id, treat it as the decision.
    let best: string | null = null;
    let bestPos = -1;
    for (const id of ids) {
      const pos = lower.lastIndexOf(id.toLowerCase());
      if (pos > bestPos) {
        bestPos = pos;
        best = id;
      }
    }
    if (bestPos === -1 || lower.lastIndexOf("none") > bestPos) {
      return { destination: null, sourceTypes: [] };
    }
    const sourceTypes = extractSourceTypes(lower.slice(bestPos));
    console.log(`[router] classified "${message.slice(0, 40)}" → ${best}${sourceTypes.length ? ` [${sourceTypes}]` : ""}`);
    return { destination: best, sourceTypes };
  } catch (err) {
    console.warn("[router] intent classification failed:", err);
    return { destination: null, sourceTypes: [] };
  }
}

/** Canonicalize content-type words in the answer to discover source types. */
function extractSourceTypes(answer: string): string[] {
  const out = new Set<string>();
  if (/\bbooks?\b/.test(answer)) out.add("book");
  if (/\bpapers?\b/.test(answer)) out.add("paper");
  if (/\b(feed|feeds|rss|channels?|podcasts?)\b/.test(answer)) out.add("news");
  return [...out];
}

/** Single ephemeral in-memory completion on the fast lookup model. */
async function runClassifier(prompt: string): Promise<string> {
  const serverConfig = getServerConfig();
  const repoRoot = join(import.meta.dirname, "../../../..");
  const { authStorage, modelRegistry, selectedModel } = configureModelRegistry(serverConfig);

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
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
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
}
