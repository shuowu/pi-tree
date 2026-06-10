/**
 * setup-mock — Activates mock AI for the pi-tree server.
 *
 * Call `setupPiMock()` at server startup when `PI_MOCK=true` to replace
 * real LLM calls with scripted mock responses. The real SessionManager
 * is still used, so tree structure, JSONL persistence, and all metadata
 * operations work exactly as in production.
 *
 * Usage:
 * ```ts
 * import { setupPiMock } from "./testing/setup-mock.js";
 * if (process.env.PI_MOCK === "true") {
 *   setupPiMock();
 * }
 * ```
 */

import { PiSession } from "@pi-tree/core";
import {
  createMockAgentSession,
  type MockAgentConfig,
} from "./mock-agent.js";

// ---------------------------------------------------------------------------
// Default config — sensible defaults for e2e tests
// ---------------------------------------------------------------------------

const DEFAULT_MOCK_CONFIG: MockAgentConfig = {
  defaultResponse: `I'm a mock AI assistant for testing. I received your message and I'm responding with a pre-configured test response.

This mock supports:
- **Streaming**: Tokens are emitted with realistic delays
- **Tree operations**: Branch, navigate, and view operations work with real SessionManager
- **Tool calls**: Can simulate tool execution for testing UI indicators

Ask me anything and I'll respond with this default message.`,
  tokenDelay: 5,
  chunkSize: 3,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

/**
 * Install the mock agent factory on `PiSession`.
 *
 * After this call, every `PiSession.create()` will use a `MockAgentSession`
 * instead of calling the real Pi SDK. The real `SessionManager` is still
 * created normally (JSONL files, tree storage), so the only thing replaced
 * is the LLM interaction.
 *
 * @param config  Optional overrides for response behavior.
 * @returns A teardown function that restores normal `PiSession.create()` behavior.
 */
export function setupPiMock(config?: MockAgentConfig): () => void {
  const mergedConfig = { ...DEFAULT_MOCK_CONFIG, ...config };

  PiSession.setAgentFactory(async (sm, _serverConfig) => {
    return createMockAgentSession(sm, mergedConfig);
  });

  console.log("🧪 PI_MOCK active — AI responses are mocked");

  return () => {
    PiSession.setAgentFactory(null);
    console.log("🧪 PI_MOCK deactivated — AI responses restored");
  };
}
