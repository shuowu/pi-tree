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

  return (
    <StreamContext.Provider value={{ streams, startMessageStream, clearStream, stopStream }}>
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
