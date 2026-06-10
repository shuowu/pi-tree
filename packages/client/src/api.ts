/**
 * API client for pi-tree server.
 * All calls go through the Vite dev proxy → localhost:3847.
 */

import type { SessionState, TreeNodeView } from "@pi-tree/core/types";
import type {
  Source,
  SourceOutline,
  SourceSession,
  SessionContext,
  UserInfo,
  RecentSession,
  SourceType,
} from "@pi-tree/shared";

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
  api: string;
}

let _configCache: ClientServerConfig | null = null;

export async function fetchServerConfig(force = false): Promise<ClientServerConfig> {
  if (_configCache && !force) return _configCache;
  const res = await fetch(`${API}/config`);
  if (!res.ok) return { readingModel: "unknown", lookupModel: "unknown", provider: "", apiKey: "", baseUrl: "", api: "" };
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

export async function fetchSources(opts?: { search?: string; tags?: string[]; type?: SourceType }): Promise<Source[]> {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.tags?.length) params.set('tags', opts.tags.join(','));
  if (opts?.type) params.set('type', opts.type);
  const qs = params.toString();
  const url = `${API}/library/sources${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sources: ${res.status}`);
  const data = await res.json();
  return data.sources;
}

export async function fetchTags(): Promise<string[]> {
  const res = await fetch(`${API}/library/tags`);
  if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
  const data = await res.json();
  return data.tags;
}

export async function addSourceTag(sourceId: string, tag: string): Promise<void> {
  const res = await fetch(`${API}/library/sources/${encodeURIComponent(sourceId)}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok) throw new Error(`Failed to add tag: ${res.status}`);
}

export async function removeSourceTag(sourceId: string, tag: string): Promise<void> {
  const res = await fetch(`${API}/library/sources/${encodeURIComponent(sourceId)}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to remove tag: ${res.status}`);
}

export async function fetchSource(sourceId: string): Promise<Source> {
  const res = await fetch(`${API}/library/sources/${sourceId}`);
  if (!res.ok) throw new Error(`Source not found: ${sourceId}`);
  return res.json();
}

export async function fetchOutline(sourceId: string): Promise<SourceOutline | null> {
  const res = await fetch(`${API}/library/sources/${sourceId}/outline`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchContent(
  sourceId: string,
  startLine: number,
  endLine: number,
): Promise<string> {
  const res = await fetch(
    `${API}/library/sources/${sourceId}/content?start=${startLine}&end=${endLine}`,
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

export async function fetchHeadings(sourceId: string): Promise<BookHeading[]> {
  const res = await fetch(`${API}/library/sources/${sourceId}/headings`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.headings ?? [];
}

export async function uploadSource(file: File, meta: {
  title: string; author: string; year?: number;
}): Promise<Source> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', meta.title);
  formData.append('author', meta.author);
  if (meta.year) formData.append('year', String(meta.year));

  const res = await fetch(`${API}/library/sources`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteSource(sourceId: string): Promise<void> {
  const res = await fetch(`${API}/library/sources/${sourceId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function processSource(sourceId: string): Promise<void> {
  const res = await fetch(`${API}/library/sources/${sourceId}/process`, { method: 'POST' });
  if (!res.ok) throw new Error(`Processing trigger failed: ${res.status}`);
}

export interface Job {
  id: string;
  sourceId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  step: string;
  error?: string | null;
}

export interface JobWithSource extends Job {
  sourceTitle: string;
  sourceAuthor: string;
}

export async function fetchJobStatus(sourceId: string): Promise<Job | null> {
  const res = await fetch(`${API}/library/sources/${sourceId}/job`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.job;
}

export async function fetchJobs(): Promise<JobWithSource[]> {
  const res = await fetch(`${API}/library/jobs`);
  if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status}`);
  const data = await res.json();
  return data.jobs || [];
}

export async function fetchRecentSessions(
  userId: string,
  opts?: { limit?: number; search?: string },
): Promise<RecentSession[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.search) params.set('search', opts.search);
  const qs = params.toString();
  const res = await fetch(`${API}/sessions/${userId}/recent${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch recent sessions: ${res.status}`);
  const data = await res.json();
  return data.sessions;
}


// ---------------------------------------------------------------------------
// Session Management (CRUD) — multi-session per source
// ---------------------------------------------------------------------------

/**
 * Fetch all sessions for a user+source pair.
 */
export async function fetchSessions(userId: string, sourceId: string): Promise<SourceSession[]> {
  const res = await fetch(`${API}/sessions/${userId}/${sourceId}`);
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  const data = await res.json();
  return data.sessions;
}

/**
 * Create a new session for a user+source pair.
 */
export async function createSession(
  userId: string,
  sourceId: string,
  title: string,
  context?: SessionContext,
): Promise<SourceSession> {
  const res = await fetch(`${API}/sessions/${userId}/${sourceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, context }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json();
}

/**
 * Update a session's title or context.
 */
export async function updateSession(
  userId: string,
  sourceId: string,
  sessionId: number,
  updates: { title?: string; context?: SessionContext },
): Promise<void> {
  const res = await fetch(`${API}/sessions/${userId}/${sourceId}/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update session: ${res.status}`);
}

/**
 * Delete (soft-delete) a session.
 */
export async function deleteSession(
  userId: string,
  sourceId: string,
  sessionId: number,
): Promise<void> {
  const res = await fetch(`${API}/sessions/${userId}/${sourceId}/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete session: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Session Interaction — all accept sessionId
// ---------------------------------------------------------------------------

/**
 * Start or resume a session for a source.
 * Returns existing state (with messages) if the session already exists,
 * or a fresh empty state for a new session.
 */
export async function startSession(userId: string, sourceId: string, sessionId: number): Promise<SessionState> {
  const res = await fetch(`${API}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId }),
  });
  if (!res.ok) throw new Error(`Failed to start session: ${res.status}`);
  return res.json();
}

/**
 * Reset a source's session — clears all history.
 * The next startSession call will create a fresh session.
 */
export async function resetSession(userId: string, sourceId: string, sessionId: number): Promise<void> {
  const res = await fetch(`${API}/session/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId }),
  });
  if (!res.ok) throw new Error(`Failed to reset session: ${res.status}`);
}

export async function fetchRouterSession(userId: string): Promise<{ sessionId: number; sourceId: string }> {
  const res = await fetch(`${API}/router/session/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Failed to get router session: ${res.status}`);
  return res.json();
}

export async function sendMessage(
  userId: string,
  sourceId: string,
  sessionId: number,
  message: string,
  viewNodeId?: string | null,
): Promise<SessionState & { response: string }> {
  const res = await fetch(`${API}/session/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId, message, viewNodeId }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
  return res.json();
}

export async function sendMessageStreaming(
  userId: string,
  sourceId: string,
  sessionId: number,
  message: string,
  viewNodeId: string | null,
  callbacks: {
    onToken: (token: string) => void;
    onTurnEnd?: () => void;
    onToolCall?: (info: { toolName: string; args: Record<string, unknown> }) => void;
    onToolResult?: (info: { toolName: string; result: unknown; isError: boolean }) => void;
    onQueued?: () => void;
    onCompaction?: (isCompacting: boolean) => void;
    onTreeUpdate?: (tree: import("@pi-tree/core/types").TreeNodeView) => void;
    onDone: (result: SessionState & { response: string }) => void;
    onError: (error: Error) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API}/session/message/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId, message, viewNodeId }),
    signal,
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
  let receivedDone = false;

  try {
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
            case "queued":
              callbacks.onQueued?.();
              break;
            case "turn_end":
              callbacks.onTurnEnd?.();
              break;
            case "tool_call":
              callbacks.onToolCall?.({
                toolName: event.toolName,
                args: event.args ?? {},
              });
              break;
            case "tool_result":
              callbacks.onToolResult?.({
                toolName: event.toolName,
                result: event.result,
                isError: event.isError ?? false,
              });
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
            case "error":
              callbacks.onError(new Error(event.error || "Unknown streaming error"));
              return;
            case "done":
              // The server sends the full state + response in the done event
              receivedDone = true;
              callbacks.onDone(event as SessionState & { response: string });
              break;
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  } catch (err) {
    // Aborted by caller (e.g. new message sent) — not an error
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    throw err;
  }

  if (!receivedDone) {
    callbacks.onError(new Error("Stream ended unexpectedly"));
  }
}

export async function navigateTo(
  userId: string,
  sourceId: string,
  sessionId: number,
  nodeId: string,
  options?: { summarize?: boolean },
): Promise<SessionState> {
  const res = await fetch(`${API}/session/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId, targetNodeId: nodeId, ...options }),
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
  sourceId: string,
  sessionId: number,
  viewNodeId: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/view`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId, viewNodeId }),
  });
  if (!res.ok) throw new Error(`View scope failed: ${res.status}`);
  return res.json();
}

export async function fetchTree(userId: string, sourceId: string, sessionId: number): Promise<TreeNodeView> {
  const res = await fetch(`${API}/session/tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId }),
  });
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.status}`);
  return res.json();
}

/**
 * Delete (abandon) a node from the session tree.
 * The node is marked as abandoned and hidden from the default tree view.
 */
export async function deleteNode(
  userId: string,
  sourceId: string,
  sessionId: number,
  nodeId: string,
  viewNodeId?: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/delete-node`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId, nodeId, viewNodeId }),
  });
  if (!res.ok) throw new Error(`Delete node failed: ${res.status}`);
  return res.json();
}

/**
 * Rename a node in the session tree.
 */
export async function renameNode(
  userId: string,
  sourceId: string,
  sessionId: number,
  nodeId: string,
  newLabel: string,
  viewNodeId?: string | null,
): Promise<SessionState> {
  const res = await fetch(`${API}/session/rename-node`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, sessionId, nodeId, newLabel, viewNodeId }),
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
  sourceId: string | undefined,
  term: string,
  onToken: (token: string) => void,
  context?: string,
): Promise<string> {
  const res = await fetch(`${API}/dict/lookup/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, term, context }),
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
  sourceId: string,
  term: string,
  definition?: string,
): Promise<void> {
  const res = await fetch(`${API}/dict/glossary/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, sourceId, term, definition }),
  });
  if (!res.ok) throw new Error(`Save glossary failed: ${res.status}`);
}

/**
 * Fetch all saved glossary entries for a user+source.
 */
export async function fetchGlossary(
  userId: string,
  sourceId: string,
): Promise<Array<{ id: number; term: string; definition: string | null; createdAt: string }>> {
  const res = await fetch(`${API}/dict/glossary/${userId}/${sourceId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.entries ?? [];
}
