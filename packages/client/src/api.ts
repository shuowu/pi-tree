/**
 * API client for pi-reader server.
 * All calls go through the Vite dev proxy → localhost:3001.
 */

import type {
  Book,
  BookOutline,
  SessionState,
  TreeNodeView,
} from "@pi-reader/shared";

const API = "/api";

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export async function fetchBooks(): Promise<Book[]> {
  const res = await fetch(`${API}/library/books`);
  if (!res.ok) throw new Error(`Failed to fetch books: ${res.status}`);
  const data = await res.json();
  return data.books;
}

export async function fetchBook(bookId: string): Promise<Book> {
  const res = await fetch(`${API}/library/books/${bookId}`);
  if (!res.ok) throw new Error(`Book not found: ${bookId}`);
  const data = await res.json();
  return data.book;
}

export async function fetchOutline(bookId: string): Promise<BookOutline | null> {
  const res = await fetch(`${API}/library/books/${bookId}/outline`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchContent(
  bookId: string,
  startLine: number,
  endLine: number,
): Promise<string> {
  const res = await fetch(
    `${API}/library/books/${bookId}/content?startLine=${startLine}&endLine=${endLine}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch content`);
  const data = await res.json();
  return data.content;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Start or resume a session for a book.
 * Returns existing state (with messages) if the session already exists,
 * or a fresh empty state for a new session.
 */
export async function startSession(bookId: string): Promise<SessionState> {
  const res = await fetch(`${API}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId }),
  });
  if (!res.ok) throw new Error(`Failed to start session: ${res.status}`);
  return res.json();
}

export async function sendMessage(
  bookId: string,
  message: string,
  viewNodeId?: string | null,
): Promise<SessionState & { response: string }> {
  const res = await fetch(`${API}/session/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, message, viewNodeId }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
  return res.json();
}

export async function sendMessageStreaming(
  bookId: string,
  message: string,
  onToken: (token: string) => void,
  onTreeUpdate: (update: unknown) => void,
  onDone: (result: SessionState & { response: string }) => void,
): Promise<void> {
  const res = await fetch(`${API}/session/message/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, message }),
  });

  if (!res.ok) throw new Error(`Stream failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const event = JSON.parse(data);
        switch (event.type) {
          case "token":
            onToken(event.token);
            break;
          case "tree_update":
            onTreeUpdate(event.update);
            break;
          case "done":
            onDone(event.result);
            break;
        }
      } catch {
        // Skip malformed events
      }
    }
  }
}

export async function navigateTo(
  bookId: string,
  nodeId: string,
  options?: { summarize?: boolean },
): Promise<SessionState> {
  const res = await fetch(`${API}/session/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, targetNodeId: nodeId, ...options }),
  });
  if (!res.ok) throw new Error(`Navigate failed: ${res.status}`);
  return res.json();
}

/**
 * Scope the chat view to a specific tree node (no AI call).
 * Returns messages in the linear chain from that node to the next fork.
 * Pass null for root view.
 */
export async function viewScope(
  bookId: string,
  viewNodeId: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, viewNodeId }),
  });
  if (!res.ok) throw new Error(`View scope failed: ${res.status}`);
  return res.json();
}

export async function fetchTree(bookId: string): Promise<TreeNodeView> {
  const res = await fetch(`${API}/session/tree/${bookId}`);
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`);
  const data = await res.json();
  return data.tree;
}
