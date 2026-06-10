/**
 * E2E test helpers — shared setup for Playwright tests.
 *
 * Provides API helpers for seeding test data (users, sources, sessions)
 * and common selectors for the UI.
 */

import { type Page, type APIRequestContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function api(request: APIRequestContext) {
  return {
    async createUser(id: string, displayName: string) {
      const res = await request.post("/api/users", {
        data: { id, displayName },
      });
      // 201 = created, 409 = already exists — both are fine
      if (res.status() !== 201 && res.status() !== 409) {
        throw new Error(`Failed to create user: ${res.status()}`);
      }
      return res.status() === 201 ? await res.json() : { id, displayName };
    },

    async deleteUser(id: string) {
      await request.delete(`/api/users/${id}`).catch(() => {});
    },

    /**
     * Seed a source directly in the DB (test-only route, PI_MOCK=true).
     * Bypasses file upload — creates a bare source record.
     */
    async seedSource(id: string, title: string, opts?: { author?: string; type?: string }) {
      const res = await request.post("/api/test/seed-source", {
        data: { id, title, author: opts?.author ?? "Test Author", type: opts?.type ?? "book" },
      });
      if (res.status() !== 201) {
        // Ignore "already exists" errors from onConflictDoNothing
        const text = await res.text();
        if (!text.includes("already exists")) {
          // Still ok — onConflictDoNothing returns 201 even for dupes
        }
      }
      return { id, title };
    },

    async createSession(
      userId: string,
      sourceId: string,
      title: string,
      context?: { mode?: string },
    ) {
      const res = await request.post(`/api/sessions/${userId}/${sourceId}`, {
        data: { title, context },
      });
      if (res.status() !== 201) {
        throw new Error(`Failed to create session: ${res.status()} ${await res.text()}`);
      }
      return (await res.json()) as { id: number; title: string };
    },

    async health() {
      const res = await request.get("/health");
      return res.json();
    },
  };
}

// ---------------------------------------------------------------------------
// Login helper — sets localStorage to skip UserPicker
// ---------------------------------------------------------------------------

async function loginAs(page: Page, userId: string, displayName: string) {
  await page.addInitScript(
    ({ userId, displayName }) => {
      localStorage.setItem("pi-tree-user-id", userId);
      localStorage.setItem("pi-tree-display-name", displayName);
    },
    { userId, displayName },
  );
}

// ---------------------------------------------------------------------------
// Selectors — all the pit-* class names from @pi-tree/ui
// ---------------------------------------------------------------------------

const sel = {
  // Chat
  chatView: ".pit-chat-view",
  chatInput: "textarea.pit-chat-input",
  chatSend: "button.pit-chat-send",
  chatMessages: ".pit-chat-messages",
  chatEmpty: ".pit-chat-empty",
  chatLoading: ".pit-chat-loading",
  chatStreaming: ".pit-streaming",

  // Messages
  userMessage: ".pit-chat-message-user",
  assistantMessage: ".pit-chat-message-assistant",
  messageBubble: ".pit-chat-bubble",
  messageContent: ".pit-chat-content",

  // Tool calls
  toolCallIndicator: ".pit-tool-call",

  // Branches
  inlineBranches: ".pit-inline-branches",
} as const;

export { api, loginAs, sel };
