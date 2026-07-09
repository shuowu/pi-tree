import {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { sendMessageStreaming } from "./api";
import type { TreeNodeView, SessionState, ToolStep } from "@pi-tree/core/types";

export interface ActiveStreamState {
  gen: number;
  sendingNodeId: string | null;
  accumulatedText: string;
  isQueued: boolean;
  activeToolCall: { toolName: string; args: Record<string, unknown> } | null;
  completedSteps: ToolStep[];
  isCompacting: boolean;
  status: "streaming" | "done" | "error";
  result?: SessionState & { response: string };
  error?: Error | null;
}

/** A message the user typed while a stream was in flight — sent when the
 *  active stream for the same session finishes. */
export interface QueuedSend {
  id: string;
  message: string;
  /** Node the message was composed from (resolved at enqueue time) */
  sendingNodeId: string | null;
  forceBranch?: boolean;
  /** When true, the send follows the conversation: it is sent from wherever
   *  the previous response landed instead of the node captured at enqueue
   *  time (which would create a sibling branch). Set for plain follow-ups
   *  typed while watching the active stream. */
  chainToResult?: boolean;
}

interface StreamContextValue {
  streams: Record<string, ActiveStreamState>;
  startMessageStream: (
    userId: string,
    sourceId: string,
    sessionId: number,
    message: string,
    viewNodeId: string | null,
    onTreeUpdate: (tree: TreeNodeView) => void,
    opts?: { forceBranch?: boolean },
  ) => Promise<void>;
  clearStream: (sourceId: string, sessionId: number) => void;
  stopStream: (sourceId: string, sessionId: number) => void;
  /** Pending sends per session key, in FIFO order */
  queuedSends: Record<string, QueuedSend[]>;
  enqueueSend: (sourceId: string, sessionId: number, send: QueuedSend) => void;
  /** Remove and return the next queued send for the session, if any */
  popQueuedSend: (sourceId: string, sessionId: number) => QueuedSend | undefined;
  cancelQueuedSend: (sourceId: string, sessionId: number, id: string) => void;
}

const StreamContext = createContext<StreamContextValue | null>(null);

function getStreamKey(sourceId: string, sessionId: number): string {
  return `${sourceId}:${sessionId}`;
}

/* eslint-disable react-refresh/only-export-components */

export function StreamProvider({ children }: { children: ReactNode }) {
  const [streams, setStreams] = useState<Record<string, ActiveStreamState>>({});
  const streamGensRef = useRef<Record<string, number>>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  const startMessageStream = useCallback(
    async (
      userId: string,
      sourceId: string,
      sessionId: number,
      message: string,
      viewNodeId: string | null,
      onTreeUpdate: (tree: TreeNodeView) => void,
      opts?: { forceBranch?: boolean },
    ) => {
      const key = getStreamKey(sourceId, sessionId);
      const nextGen = (streamGensRef.current[key] ?? 0) + 1;
      streamGensRef.current[key] = nextGen;

      // Abort any in-flight stream for this key before starting a new one
      abortControllersRef.current[key]?.abort();
      const controller = new AbortController();
      abortControllersRef.current[key] = controller;

      setStreams((prev) => ({
        ...prev,
        [key]: {
          gen: nextGen,
          sendingNodeId: viewNodeId,
          accumulatedText: "",
          isQueued: false,
          activeToolCall: null,
          completedSteps: [],
          isCompacting: false,
          status: "streaming",
        },
      }));

      try {
        await sendMessageStreaming(userId, sourceId, sessionId, message, viewNodeId, {
          onToken: (token) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  accumulatedText: stream.accumulatedText + token,
                  isQueued: false,
                  activeToolCall: null,
                },
              };
            });
          },
          onTurnEnd: () => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            // Don't reset accumulatedText here. The old behavior cleared the
            // text on every turn boundary, which is correct for multi-turn
            // tool-call flows (the preamble like "Let me look that up…" gets
            // cleared). However, on the *final* turn_end (which fires right
            // before `done`), clearing the text causes a visible blink:
            // StreamingBubble disappears → loading dots flash → final
            // MessageBubble appears. Instead, we clear the activeToolCall
            // so the tool indicator vanishes, and let the streaming bubble
            // stay visible with whatever text was accumulated. The `done`
            // handler replaces it with the final messages.
            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  activeToolCall: null,
                },
              };
            });
          },
          onToolCall: (info) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            // Clear accumulatedText here (not in onTurnEnd) so that interim
            // preamble like "Let me look that up…" doesn't persist. A tool
            // call always follows a turn_end for multi-turn flows, and never
            // fires for the final turn — so this is the safe place to clear.
            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  accumulatedText: "",
                  activeToolCall: info,
                  completedSteps: [
                    ...stream.completedSteps,
                    { toolName: info.toolName, args: info.args, status: "running" as const },
                  ],
                },
              };
            });
          },
          onToolResult: (info) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              // Find the last running step and mark it done/error
              const updatedSteps = [...stream.completedSteps];
              for (let i = updatedSteps.length - 1; i >= 0; i--) {
                if (updatedSteps[i].status === "running") {
                  updatedSteps[i] = {
                    ...updatedSteps[i],
                    status: info.isError ? "error" : "done",
                  };
                  break;
                }
              }
              return {
                ...prev,
                [key]: {
                  ...stream,
                  completedSteps: updatedSteps,
                },
              };
            });
          },
          onCompaction: (compacting) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  isCompacting: compacting,
                },
              };
            });
          },
          onQueued: () => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  isQueued: true,
                },
              };
            });
          },
          onTreeUpdate: (updatedTree) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;
            onTreeUpdate(updatedTree);
          },
          onDone: (result) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  status: "done",
                  result,
                },
              };
            });
          },
          onError: (err) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  status: "error",
                  error: err,
                },
              };
            });
          },
        }, controller.signal, opts);
      } catch (err) {
        // Treat abort as a graceful stop, not an error
        if (err instanceof DOMException && err.name === "AbortError") {
          const currentGen = streamGensRef.current[key];
          if (nextGen !== currentGen) return;

          setStreams((prev) => {
            const stream = prev[key];
            if (!stream || stream.gen !== nextGen) return prev;
            return {
              ...prev,
              [key]: {
                ...stream,
                status: "done",
              },
            };
          });
          return;
        }

        const currentGen = streamGensRef.current[key];
        if (nextGen !== currentGen) return;

        setStreams((prev) => {
          const stream = prev[key];
          if (!stream || stream.gen !== nextGen) return prev;
          return {
            ...prev,
            [key]: {
              ...stream,
              status: "error",
              error: err instanceof Error ? err : new Error(String(err)),
            },
          };
        });
      } finally {
        delete abortControllersRef.current[key];
      }
    },
    [],
  );

  const clearStream = useCallback((sourceId: string, sessionId: number) => {
    const key = getStreamKey(sourceId, sessionId);
    setStreams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const stopStream = useCallback((sourceId: string, sessionId: number) => {
    const key = getStreamKey(sourceId, sessionId);
    abortControllersRef.current[key]?.abort();
  }, []);

  // ---------------------------------------------------------------------------
  // Queued sends — messages typed while a stream was in flight.
  // Stored here (not in the reader hook) so the queue survives navigation
  // and reader remounts. A ref is the source of truth so pops are synchronous;
  // the state mirror drives rendering.
  // ---------------------------------------------------------------------------

  const queuedSendsRef = useRef<Record<string, QueuedSend[]>>({});
  const [queuedSends, setQueuedSends] = useState<Record<string, QueuedSend[]>>({});

  const syncQueues = useCallback(() => {
    setQueuedSends({ ...queuedSendsRef.current });
  }, []);

  const enqueueSend = useCallback((sourceId: string, sessionId: number, send: QueuedSend) => {
    const key = getStreamKey(sourceId, sessionId);
    queuedSendsRef.current[key] = [...(queuedSendsRef.current[key] ?? []), send];
    syncQueues();
  }, [syncQueues]);

  const popQueuedSend = useCallback((sourceId: string, sessionId: number): QueuedSend | undefined => {
    const key = getStreamKey(sourceId, sessionId);
    const queue = queuedSendsRef.current[key];
    if (!queue?.length) return undefined;
    const [next, ...rest] = queue;
    if (rest.length) {
      queuedSendsRef.current[key] = rest;
    } else {
      delete queuedSendsRef.current[key];
    }
    syncQueues();
    return next;
  }, [syncQueues]);

  const cancelQueuedSend = useCallback((sourceId: string, sessionId: number, id: string) => {
    const key = getStreamKey(sourceId, sessionId);
    const queue = queuedSendsRef.current[key];
    if (!queue) return;
    const rest = queue.filter((s) => s.id !== id);
    if (rest.length) {
      queuedSendsRef.current[key] = rest;
    } else {
      delete queuedSendsRef.current[key];
    }
    syncQueues();
  }, [syncQueues]);

  return (
    <StreamContext.Provider
      value={{
        streams,
        startMessageStream,
        clearStream,
        stopStream,
        queuedSends,
        enqueueSend,
        popQueuedSend,
        cancelQueuedSend,
      }}
    >
      {children}
    </StreamContext.Provider>
  );
}

export function useStream(): StreamContextValue {
  const ctx = useContext(StreamContext);
  if (!ctx) {
    throw new Error("useStream must be used within a StreamProvider");
  }
  return ctx;
}
