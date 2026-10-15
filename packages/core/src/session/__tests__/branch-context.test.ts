/**
 * Branch-scoped LLM context — end-to-end through the real Pi SDK agent loop.
 *
 * PiSession moves the SDK leaf pointer with `sm.branch()`. The agent, however,
 * prompts from its in-memory `state.messages`, which `sm.branch()` does not
 * touch. These tests drive a real AgentSession against pi-ai's faux provider
 * and assert the model only ever sees the current branch's path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { PiSession } from "../pi-session.js";

// pi-ai is a nested dependency of pi-coding-agent. Import that exact copy so
// the faux provider registers into the same API registry the SDK streams from.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const piAiCompat = join(
  repoRoot,
  "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/compat.js",
);

type Faux = {
  getModel(): any;
  setResponses(r: unknown[]): void;
  unregister(): void;
};

/** Text of each user message the model received, in order. */
function userTexts(messages: any[]): string[] {
  return messages
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(""),
    );
}

describe("PiSession branch context", () => {
  let dir: string;
  let faux: Faux;
  let fauxAssistantMessage: (text: string) => unknown;
  let seen: string[][];
  let piSession: PiSession;
  let sm: SessionManager;

  beforeAll(async () => {
    const ai = await import(pathToFileURL(piAiCompat).href);
    fauxAssistantMessage = ai.fauxAssistantMessage;
    faux = ai.registerFauxProvider({ provider: "faux-branch-test" });
    dir = mkdtempSync(join(tmpdir(), "pi-tree-branch-ctx-"));
  });

  afterAll(() => {
    faux?.unregister();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function setup(): Promise<void> {
    seen = [];
    // Reply "re:<last user text>" and record every context the model is sent.
    const reply = (context: any) => {
      const texts = userTexts(context.messages);
      seen.push(texts);
      return fauxAssistantMessage(`re:${texts[texts.length - 1]}`);
    };
    faux.setResponses(Array.from({ length: 20 }, () => reply));

    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("faux-branch-test", "test-key");
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
    });
    await resourceLoader.reload();

    sm = SessionManager.inMemory(dir);
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      model: faux.getModel(),
      authStorage,
      modelRegistry: ModelRegistry.inMemory(authStorage),
      resourceLoader,
      sessionManager: sm,
      settingsManager: SettingsManager.inMemory(),
      excludeTools: ["bash", "edit"],
    });
    // The constructor is private; create() needs a real model registry/config.
    piSession = new (PiSession as any)(sm, session, "book", dir);
  }

  /** Id of the assistant reply to the given user text. */
  function replyIdFor(text: string): string {
    const entry = sm
      .getEntries()
      .find(
        (e: any) =>
          e.type === "message" &&
          e.message.role === "assistant" &&
          e.message.content.some((c: any) => c.type === "text" && c.text === `re:${text}`),
      );
    if (!entry) throw new Error(`no reply for ${text}`);
    return entry.id;
  }

  it("forking from an earlier reply drops the abandoned branch from context", async () => {
    await setup();
    await piSession.sendMessage("A1");
    await piSession.sendMessage("A2");

    piSession.simpleBranch(replyIdFor("A1"));
    await piSession.sendMessage("B1");

    expect(seen.at(-1)).toEqual(["A1", "B1"]);
  });

  it("returning to the original branch excludes the sibling branch", async () => {
    await setup();
    await piSession.sendMessage("A1");
    await piSession.sendMessage("A2");

    piSession.simpleBranch(replyIdFor("A1"));
    await piSession.sendMessage("B1");

    piSession.simpleBranch(replyIdFor("A2"));
    await piSession.sendMessage("A3");

    expect(seen.at(-1)).toEqual(["A1", "A2", "A3"]);
  });

  it("branchAt (topic node) also scopes context to the new branch", async () => {
    await setup();
    await piSession.sendMessage("A1");
    await piSession.sendMessage("A2");

    piSession.branchAt(replyIdFor("A1"), { label: "side topic", source: "user", status: "active" } as any);
    await piSession.sendMessage("T1");

    expect(seen.at(-1)).toEqual(["A1", "T1"]);
  });
});
