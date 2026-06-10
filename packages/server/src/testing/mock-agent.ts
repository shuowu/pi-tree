/**
 * MockAgentSession — a lightweight stand-in for Pi SDK's AgentSession.
 *
 * Emits the same event shapes (`message_update`, `message_end`,
 * `tool_execution_start/end`) so PiSession's streaming logic works unchanged.
 * Uses the real SessionManager to append user/assistant message entries,
 * keeping the session JSONL and tree structure intact for tree operations.
 *
 * Activate via `PiSession.setAgentFactory()` — see `setup-mock.ts`.
 */

import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionEventListener,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * A single scripted scenario: text response with optional leading tool calls.
 */
export interface MockScenario {
  /** Text response to stream back. */
  response: string;
  /** Optional tool calls to emit before the text response. */
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    isError?: boolean;
  }>;
}

/**
 * Configuration for the mock agent's response behavior.
 */
export interface MockAgentConfig {
  /** Default response when no scenario matches. */
  defaultResponse?: string;
  /**
   * Map message patterns to responses.
   * - String keys are matched as case-insensitive substrings.
   * - RegExp keys are tested against the full message.
   * - Values can be a plain string (shortcut for `{ response: string }`)
   *   or a full `MockScenario`.
   */
  responses?: Map<string | RegExp, string | MockScenario>;
  /** Delay between emitted chunks in ms (default: 5). */
  tokenDelay?: number;
  /** Number of characters per chunk (default: 3). */
  chunkSize?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RESPONSE = `I'm a mock AI assistant for testing. I received your message and I'm responding with a pre-configured test response.

This mock supports:
- **Streaming**: Tokens are emitted with realistic delays
- **Tree operations**: Branch, navigate, and view operations work with real SessionManager
- **Tool calls**: Can simulate tool execution for testing UI indicators

Ask me anything and I'll respond with this default message.`;

// ---------------------------------------------------------------------------
// MockAgentSession
// ---------------------------------------------------------------------------

/**
 * Create a mock agent that conforms to the AgentSession interface surface
 * used by `PiSession`.
 *
 * Only the methods PiSession actually calls are implemented:
 * - `subscribe` / unsubscribe
 * - `prompt`
 * - `setAutoCompactionEnabled`
 * - `compact`
 * - `isCompacting`
 * - `dispose`
 *
 * Everything else is left as a no-op proxy so accidental property reads
 * don't crash.
 */
export function createMockAgentSession(
  sm: SessionManager,
  config: MockAgentConfig = {},
): AgentSession {
  const listeners = new Set<AgentSessionEventListener>();
  const tokenDelay = config.tokenDelay ?? 5;
  const chunkSize = config.chunkSize ?? 3;
  const defaultResponse = config.defaultResponse ?? DEFAULT_RESPONSE;
  const responseMap = config.responses ?? new Map();

  // --- helpers ---------------------------------------------------------------

  function emit(event: AgentSessionEvent) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // swallow listener errors — mirrors SDK behavior
      }
    }
  }

  function resolveScenario(message: string): MockScenario {
    for (const [pattern, value] of responseMap) {
      const matched =
        pattern instanceof RegExp
          ? pattern.test(message)
          : message.toLowerCase().includes(pattern.toLowerCase());
      if (matched) {
        return typeof value === "string" ? { response: value } : value;
      }
    }
    return { response: defaultResponse };
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // Build a minimal mock AgentMessage for events
  function makeAssistantMessage(text: string): any {
    return {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "mock",
      provider: "mock",
      model: "mock-model",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  // --- core methods ----------------------------------------------------------

  function subscribe(listener: AgentSessionEventListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function prompt(text: string): Promise<void> {
    const scenario = resolveScenario(text);

    // 1. Append user message to SessionManager (replicates SDK behavior)
    sm.appendMessage({
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    // 2. Emit tool calls if the scenario has them
    if (scenario.toolCalls) {
      for (const tc of scenario.toolCalls) {
        const toolCallId = `mock-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        emit({
          type: "tool_execution_start",
          toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        } as AgentSessionEvent);

        await sleep(tokenDelay * 5); // brief pause to simulate work

        emit({
          type: "tool_execution_end",
          toolCallId,
          toolName: tc.toolName,
          result: tc.result,
          isError: tc.isError ?? false,
        } as AgentSessionEvent);
      }
    }

    // 3. Stream the text response
    const responseText = scenario.response;
    let accumulated = "";

    for (let i = 0; i < responseText.length; i += chunkSize) {
      const delta = responseText.slice(i, i + chunkSize);
      accumulated += delta;

      emit({
        type: "message_update",
        message: makeAssistantMessage(accumulated),
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta,
          partial: makeAssistantMessage(accumulated),
        },
      } as AgentSessionEvent);

      if (tokenDelay > 0) {
        await sleep(tokenDelay);
      }
    }

    // 4. Append assistant message to SessionManager (replicates SDK behavior)
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: accumulated }],
      api: "mock",
      provider: "mock",
      model: "mock-model",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    // 5. Emit message_end
    emit({
      type: "message_end",
      message: makeAssistantMessage(accumulated),
    } as AgentSessionEvent);
  }

  // --- assemble the mock object ----------------------------------------------
  // We cast to AgentSession since we only implement the subset PiSession uses.
  // Using a Proxy ensures any un-stubbed property access returns a safe no-op
  // instead of crashing.

  const mock = {
    subscribe,
    prompt,
    setAutoCompactionEnabled: () => {},
    compact: async () => ({ summary: "Mock compaction summary" }),
    get isCompacting() {
      return false;
    },
    dispose: () => {
      listeners.clear();
    },
    // SessionManager is public on the real AgentSession — expose it so
    // downstream code that reads `agent.sessionManager` still works.
    sessionManager: sm,
  };

  return new Proxy(mock, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // Return a no-op function for any method PiSession might call that we
      // haven't explicitly stubbed. Log for discoverability during dev.
      return (..._args: unknown[]) => {
        console.warn(
          `[mock-agent] Unstubbed method called: ${String(prop)}`,
        );
      };
    },
  }) as unknown as AgentSession;
}
