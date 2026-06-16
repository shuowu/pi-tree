import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ChatMessage, BranchOption } from "@pi-tree/core/types";

// Mock mermaid before any component imports
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), run: vi.fn() } }));

import { ChatView } from "../ChatView.js";

const makeMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: "msg-1",
  role: "user",
  content: "Hello",
  timestamp: new Date().toISOString(),
  ...overrides,
});

const makeBranch = (overrides?: Partial<BranchOption>): BranchOption => ({
  nodeId: "branch-1",
  label: "Test Branch",
  messageCount: 3,
  status: "active",
  ...overrides,
});

const defaultProps = {
  messages: [] as ChatMessage[],
  isLoading: false,
  isCompacting: false,
  isQueued: false,
  streamingContent: null as string | null,
  activeToolCall: null as { toolName: string; args: Record<string, unknown> } | null,
  onSendMessage: vi.fn(),
  branches: [] as BranchOption[],
  onDrillDown: vi.fn(),
  isScoped: false,
  bookId: "test-book",
  sessionId: 1,
  userId: "test-user",
  onDefine: vi.fn(),
  scrollTopTrigger: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement scrollIntoView or scrollTo
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn() as any;
});

describe("ChatView", () => {
  // ── Message rendering ──────────────────────────────────────────────────

  describe("message rendering", () => {
    it("renders user and assistant messages with correct CSS classes", () => {
      const messages = [
        makeMessage({ id: "u1", role: "user", content: "Hi" }),
        makeMessage({ id: "a1", role: "assistant", content: "Hello!" }),
      ];
      const { container } = render(<ChatView {...defaultProps} messages={messages} />);

      expect(container.querySelector(".pit-chat-message-user")).toBeInTheDocument();
      expect(container.querySelector(".pit-chat-message-assistant")).toBeInTheDocument();
    });

    it("shows empty state when no messages and not loading", () => {
      const { container } = render(<ChatView {...defaultProps} />);
      expect(container.querySelector(".pit-chat-empty")).toBeInTheDocument();
    });

    it("hides empty state when loading", () => {
      const { container } = render(<ChatView {...defaultProps} isLoading={true} />);
      expect(container.querySelector(".pit-chat-empty")).not.toBeInTheDocument();
    });
  });

  // ── Branch rendering ───────────────────────────────────────────────────

  describe("branch rendering", () => {
    it("shows InlineBranches when branches exist and not loading", () => {
      const { container } = render(
        <ChatView {...defaultProps} branches={[makeBranch()]} />,
      );
      expect(container.querySelector(".pit-inline-branches")).toBeInTheDocument();
    });

    it("hides InlineBranches while loading", () => {
      const { container } = render(
        <ChatView {...defaultProps} branches={[makeBranch()]} isLoading={true} />,
      );
      expect(container.querySelector(".pit-inline-branches")).not.toBeInTheDocument();
    });

    it("filters out placeholder branches with messageCount=0", () => {
      const branches: BranchOption[] = [
        makeBranch({ nodeId: "real", label: "Real Branch", messageCount: 5, status: "active" }),
        makeBranch({ nodeId: "empty-placeholder", label: "Placeholder", messageCount: 0, status: "placeholder" }),
      ];
      const { container } = render(<ChatView {...defaultProps} branches={branches} />);

      const branchTitles = container.querySelectorAll(".pit-inline-branch-title");
      const labels = Array.from(branchTitles).map((el) => el.textContent);
      expect(labels).toContain("Real Branch");
      expect(labels).not.toContain("Placeholder");
    });
  });

  // ── Input behavior ─────────────────────────────────────────────────────

  describe("input behavior", () => {
    it("disables textarea when loading", () => {
      render(<ChatView {...defaultProps} isLoading={true} />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("disables send button when input is empty", () => {
      render(<ChatView {...defaultProps} />);
      expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    });

    it("enables send button when input has text", () => {
      render(<ChatView {...defaultProps} />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
      expect(screen.getByRole("button", { name: "Send message" })).not.toBeDisabled();
    });

    it("calls onSendMessage on Enter", () => {
      const onSendMessage = vi.fn();
      render(<ChatView {...defaultProps} onSendMessage={onSendMessage} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

      expect(onSendMessage).toHaveBeenCalledWith("Hello");
    });

    it("does not submit on Shift+Enter", () => {
      const onSendMessage = vi.fn();
      render(<ChatView {...defaultProps} onSendMessage={onSendMessage} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it("clears input after submit", () => {
      render(<ChatView {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

      expect(textarea).toHaveValue("");
    });
  });

  // ── Loading states ─────────────────────────────────────────────────────

  describe("loading states", () => {
    it("shows loading dots when loading with no streaming or tool call", () => {
      const { container } = render(<ChatView {...defaultProps} isLoading={true} />);
      expect(container.querySelector(".pit-chat-loading")).toBeInTheDocument();
    });

    it("shows queued message when isQueued", () => {
      render(<ChatView {...defaultProps} isLoading={true} isQueued={true} />);
      expect(screen.getByText(/Finishing a response on another branch/)).toBeInTheDocument();
    });

    it("shows StreamingBubble when streaming content", () => {
      const { container } = render(
        <ChatView {...defaultProps} isLoading={true} streamingContent="Streaming response..." />,
      );
      expect(container.querySelector(".pit-streaming")).toBeInTheDocument();
    });

    it("shows ToolCallIndicator when activeToolCall", () => {
      const { container } = render(
        <ChatView
          {...defaultProps}
          isLoading={true}
          activeToolCall={{ toolName: "read", args: { path: "/chapter1.md" } }}
        />,
      );
      expect(container.querySelector(".pit-tool-call-indicator")).toBeInTheDocument();
    });
  });

  // ── Placeholder text ───────────────────────────────────────────────────

  describe("placeholder text", () => {
    it("shows default book placeholder", () => {
      render(<ChatView {...defaultProps} />);
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        "Ask about the book, or try: deep dive, next chapter, zoom out…",
      );
    });

    it("shows 'New branch from this point…' when scoped with branches", () => {
      render(
        <ChatView {...defaultProps} isScoped={true} branches={[makeBranch()]} />,
      );
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        "New branch from this point…",
      );
    });

    it("shows 'Continue this thread…' when scoped without branches", () => {
      render(<ChatView {...defaultProps} isScoped={true} branches={[]} />);
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        "Continue this thread…",
      );
    });

    it("uses custom placeholderText when provided", () => {
      render(<ChatView {...defaultProps} placeholderText="Custom placeholder" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Custom placeholder");
    });
  });

  // ── Parent context ─────────────────────────────────────────────────────

  describe("parent context", () => {
    const parentContext = [
      makeMessage({ id: "p1", role: "user", content: "Parent question" }),
      makeMessage({ id: "p2", role: "assistant", content: "Parent answer" }),
    ];

    it("shows toggle button when parentContext provided", () => {
      render(<ChatView {...defaultProps} parentContext={parentContext} />);
      expect(screen.getByText(/Show parent context/)).toBeInTheDocument();
    });

    it("shows ancestor messages after clicking toggle", () => {
      render(<ChatView {...defaultProps} parentContext={parentContext} />);

      fireEvent.click(screen.getByText(/Show parent context/));

      expect(screen.getByText("Parent question")).toBeInTheDocument();
      expect(screen.getByText("Current branch")).toBeInTheDocument();
    });

    it("hides ancestor messages after clicking toggle again", () => {
      const { container } = render(<ChatView {...defaultProps} parentContext={parentContext} />);

      const toggle = screen.getByText(/Show parent context/);
      fireEvent.click(toggle);
      expect(container.querySelector(".pit-ancestor-messages")).toBeInTheDocument();

      fireEvent.click(screen.getByText(/Hide parent context/));
      expect(container.querySelector(".pit-ancestor-messages")).not.toBeInTheDocument();
    });
  });

  // ── Quote flow ─────────────────────────────────────────────────────────

  describe("quote flow", () => {
    it("prepends quoted text to message on submit", () => {
      const onSendMessage = vi.fn();
      render(
        <ChatView
          {...defaultProps}
          onSendMessage={onSendMessage}
          renderSelectionToolbar={({ onAsk }) => (
            <button data-testid="ask-btn" onClick={() => onAsk("important quote")}>
              Ask
            </button>
          )}
        />,
      );

      // Trigger the quote via the render prop
      fireEvent.click(screen.getByTestId("ask-btn"));

      // Type a follow-up and submit
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "What does this mean?" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

      expect(onSendMessage).toHaveBeenCalledWith("> important quote\n\nWhat does this mean?");
    });
  });
});
