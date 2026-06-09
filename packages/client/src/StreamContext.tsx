import {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { sendMessageStreaming } from "./api";
import type { TreeNodeView, SessionState } from "@pi-tree/core/types";

export interface ActiveStreamState {
  gen: number;
  sendingNodeId: string | null;
  accumulatedText: string;
  isQueued: boolean;
  activeToolCall: { toolName: string; args: Record<string, unknown> } | null;
  isCompacting: boolean;
  status: "streaming" | "done" | "error";
  result?: SessionState & { response: string };
  error?: Error | null;
}

interface StreamContextValue {
  streams: Record<string, ActiveStreamState>;
  startMessageStream: (
    userId: string,
    bookId: string,
    sessionId: number,
    message: string,
    viewNodeId: string | null,
    onTreeUpdate: (tree: TreeNodeView) => void,
  ) => Promise<void>;
  clearStream: (bookId: string, sessionId: number) => void;
}

const StreamContext = createContext<StreamContextValue | null>(null);

function getStreamKey(bookId: string, sessionId: number): string {
  return `${bookId}:${sessionId}`;
}

/* eslint-disable react-refresh/only-export-components */

export function StreamProvider({ children }: { children: ReactNode }) {
  const [streams, setStreams] = useState<Record<string, ActiveStreamState>>({});
  const streamGensRef = useRef<Record<string, number>>({});

  const startMessageStream = useCallback(
    async (
      userId: string,
      bookId: string,
      sessionId: number,
      message: string,
      viewNodeId: string | null,
      onTreeUpdate: (tree: TreeNodeView) => void,
    ) => {
      const key = getStreamKey(bookId, sessionId);
      const nextGen = (streamGensRef.current[key] ?? 0) + 1;
      streamGensRef.current[key] = nextGen;

      setStreams((prev) => ({
        ...prev,
        [key]: {
          gen: nextGen,
          sendingNodeId: viewNodeId,
          accumulatedText: "",
          isQueued: false,
          activeToolCall: null,
          isCompacting: false,
          status: "streaming",
        },
      }));

      try {
        await sendMessageStreaming(userId, bookId, sessionId, message, viewNodeId, {
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

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  accumulatedText: "",
                },
              };
            });
          },
          onToolCall: (info) => {
            const currentGen = streamGensRef.current[key];
            if (nextGen !== currentGen) return;

            setStreams((prev) => {
              const stream = prev[key];
              if (!stream || stream.gen !== nextGen) return prev;
              return {
                ...prev,
                [key]: {
                  ...stream,
                  activeToolCall: info,
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
        });
      } catch (err) {
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
      }
    },
    [],
  );

  const clearStream = useCallback((bookId: string, sessionId: number) => {
    const key = getStreamKey(bookId, sessionId);
    setStreams((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return (
    <StreamContext.Provider value={{ streams, startMessageStream, clearStream }}>
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
