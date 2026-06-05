/**
 * API client for pi-reader server.
 * All calls go through the Vite dev proxy → localhost:3847.
 */

import type {
  Book,
  BookOutline,
  SessionState,
  TreeNodeView,
  UserInfo,
} from "@pi-reader/shared";

const API = "/api";

// ---------------------------------------------------------------------------
// Server Config
// ---------------------------------------------------------------------------

export interface ClientServerConfig {
  readingModel: string;
  lookupModel: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
}

let _configCache: ClientServerConfig | null = null;

export async function fetchServerConfig(force = false): Promise<ClientServerConfig> {
  if (_configCache && !force) return _configCache;
  const res = await fetch(`${API}/config`);
  if (!res.ok) return { readingModel: "unknown", lookupModel: "unknown", provider: "", apiKey: "", baseUrl: "" };
  _configCache = await res.json();
  return _configCache!;
}

export async function saveServerConfig(cfg: Partial<ClientServerConfig>): Promise<ClientServerConfig> {
  const res = await fetch(`${API}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to save config: ${res.status}`);
  }
  const data = await res.json();
  _configCache = data.config;
  return _configCache!;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function fetchUsers(): Promise<UserInfo[]> {
  const res = await fetch(`${API}/users`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  const data = await res.json();
  return data.users;
}

export async function createUser(
  id: string,
  displayName?: string,
): Promise<UserInfo> {
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...(displayName ? { displayName } : {}) }),
  });
  if (!res.ok) throw new Error(`Failed to create user: ${res.status}`);
  return res.json();
}

export async function fetchUser(userId: string): Promise<UserInfo> {
  const res = await fetch(`${API}/users/${userId}`);
  if (!res.ok) throw new Error(`User not found: ${userId}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export async function fetchBooks(opts?: { search?: string; tags?: string[] }): Promise<Book[]> {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.tags?.length) params.set('tags', opts.tags.join(','));
  const qs = params.toString();
  const url = `${API}/library/books${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch books: ${res.status}`);
  const data = await res.json();
  return data.books;
}

export async function fetchTags(): Promise<string[]> {
  const res = await fetch(`${API}/library/tags`);
  if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
  const data = await res.json();
  return data.tags;
}

export async function addBookTag(bookId: string, tag: string): Promise<void> {
  const res = await fetch(`${API}/library/books/${encodeURIComponent(bookId)}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok) throw new Error(`Failed to add tag: ${res.status}`);
}

export async function removeBookTag(bookId: string, tag: string): Promise<void> {
  const res = await fetch(`${API}/library/books/${encodeURIComponent(bookId)}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to remove tag: ${res.status}`);
}

export async function fetchBook(bookId: string): Promise<Book> {
  const res = await fetch(`${API}/library/books/${bookId}`);
  if (!res.ok) throw new Error(`Book not found: ${bookId}`);
  return res.json();
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
    `${API}/library/books/${bookId}/content?start=${startLine}&end=${endLine}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch content`);
  const data = await res.json();
  return data.content;
}

export interface BookHeading {
  line: number;
  level: number;
  title: string;
}

export async function fetchHeadings(bookId: string): Promise<BookHeading[]> {
  const res = await fetch(`${API}/library/books/${bookId}/headings`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.headings ?? [];
}

export async function uploadBook(file: File, meta: {
  title: string; author: string; year?: number;
}): Promise<Book> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', meta.title);
  formData.append('author', meta.author);
  if (meta.year) formData.append('year', String(meta.year));

  const res = await fetch(`${API}/library/books`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteBook(bookId: string): Promise<void> {
  const res = await fetch(`${API}/library/books/${bookId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Start or resume a session for a book.
 * Returns existing state (with messages) if the session already exists,
 * or a fresh empty state for a new session.
 */
export async function startSession(userId: string, bookId: string): Promise<SessionState> {
  const res = await fetch(`${API}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId }),
  });
  if (!res.ok) throw new Error(`Failed to start session: ${res.status}`);
  return res.json();
}

/**
 * Reset a book's session — clears all history.
 * The next startSession call will create a fresh session.
 */
export async function resetSession(userId: string, bookId: string): Promise<void> {
  const res = await fetch(`${API}/session/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId }),
  });
  if (!res.ok) throw new Error(`Failed to reset session: ${res.status}`);
}

export async function sendMessage(
  userId: string,
  bookId: string,
  message: string,
  viewNodeId?: string | null,
): Promise<SessionState & { response: string }> {
  const res = await fetch(`${API}/session/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, message, viewNodeId }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
  return res.json();
}

export async function sendMessageStreaming(
  userId: string,
  bookId: string,
  message: string,
  viewNodeId: string | null,
  callbacks: {
    onToken: (token: string) => void;
    onCompaction?: (isCompacting: boolean) => void;
    onTreeUpdate?: (tree: import("@pi-reader/shared").TreeNodeView) => void;
    onDone: (result: SessionState & { response: string }) => void;
    onError: (error: Error) => void;
  },
): Promise<void> {
  const res = await fetch(`${API}/session/message/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, message, viewNodeId }),
  });

  if (!res.ok) {
    callbacks.onError(new Error(`Stream failed: ${res.status}`));
    return;
  }
  if (!res.body) {
    callbacks.onError(new Error("No response body"));
    return;
  }

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
            callbacks.onToken(event.token);
            break;
          case "compaction_start":
            callbacks.onCompaction?.(true);
            break;
          case "compaction_end":
            callbacks.onCompaction?.(false);
            break;
          case "tree_update":
            callbacks.onTreeUpdate?.(event.tree);
            break;
          case "done":
            // The server sends the full state + response in the done event
            callbacks.onDone(event as SessionState & { response: string });
            break;
        }
      } catch {
        // Skip malformed events
      }
    }
  }
}

export async function navigateTo(
  userId: string,
  bookId: string,
  nodeId: string,
  options?: { summarize?: boolean },
): Promise<SessionState> {
  const res = await fetch(`${API}/session/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, targetNodeId: nodeId, ...options }),
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
  userId: string,
  bookId: string,
  viewNodeId: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, viewNodeId }),
  });
  if (!res.ok) throw new Error(`View scope failed: ${res.status}`);
  return res.json();
}

export async function fetchTree(userId: string, bookId: string): Promise<TreeNodeView> {
  const res = await fetch(`${API}/session/tree/${userId}/${bookId}`);
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`);
  return res.json();
}

/**
 * Delete (abandon) a node from the session tree.
 * The node is marked as abandoned and hidden from the default tree view.
 */
export async function deleteNode(
  userId: string,
  bookId: string,
  nodeId: string,
  viewNodeId?: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/delete-node`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, nodeId, viewNodeId }),
  });
  if (!res.ok) throw new Error(`Delete node failed: ${res.status}`);
  return res.json();
}

/**
 * Rename a node in the session tree.
 */
export async function renameNode(
  userId: string,
  bookId: string,
  nodeId: string,
  newLabel: string,
  viewNodeId?: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/rename-node`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, nodeId, newLabel, viewNodeId }),
  });
  if (!res.ok) throw new Error(`Rename node failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Dictionary Lookup
// ---------------------------------------------------------------------------

/**
 * Stream a dictionary lookup.
 * Independent from reading sessions — uses its own ephemeral AI session.
 */
export async function streamLookup(
  userId: string,
  bookId: string | undefined,
  term: string,
  onToken: (token: string) => void,
  context?: string,
): Promise<string> {
  const res = await fetch(`${API}/dict/lookup/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, term, context }),
  });

  if (!res.ok) throw new Error(`Lookup failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullDefinition = "";

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
        if (event.type === "token") {
          onToken(event.token);
          fullDefinition += event.token;
        } else if (event.type === "done") {
          fullDefinition = event.definition || fullDefinition;
        }
      } catch {
        // skip
      }
    }
  }

  return fullDefinition;
}

/**
 * Save a term (and optional definition) to the glossary.
 */
export async function saveGlossary(
  userId: string,
  bookId: string,
  term: string,
  definition?: string,
): Promise<void> {
  const res = await fetch(`${API}/dict/glossary/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, bookId, term, definition }),
  });
  if (!res.ok) throw new Error(`Save glossary failed: ${res.status}`);
}

/**
 * Fetch all saved glossary entries for a user+book.
 */
export async function fetchGlossary(
  userId: string,
  bookId: string,
): Promise<Array<{ id: number; term: string; definition: string | null; createdAt: string }>> {
  const res = await fetch(`${API}/dict/glossary/${userId}/${bookId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.entries ?? [];
}
