/**
 * Testing utilities for pi-tree e2e tests.
 *
 * This module provides mock infrastructure that replaces Pi SDK's AI layer
 * while keeping the real SessionManager for tree operations and JSONL persistence.
 *
 * @example
 * ```ts
 * // At server startup (or in test setup):
 * import { setupPiMock } from "@pi-tree/server/testing";
 *
 * if (process.env.PI_MOCK === "true") {
 *   setupPiMock();
 * }
 * ```
 */

export { setupPiMock } from "./setup-mock.js";
export {
  createMockAgentSession,
  type MockAgentConfig,
  type MockScenario,
} from "./mock-agent.js";
