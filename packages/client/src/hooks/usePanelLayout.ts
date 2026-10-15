import { useCallback, useState } from "react";
import type { ScrollDirection } from "@pi-tree/ui";
import { getPanelWidth, setPanelWidth } from "../utils/preferences";

const DEFAULT_LEFT_WIDTH = 300;
const DEFAULT_RIGHT_WIDTH = 320;
/** Narrowest a panel goes, and the room the central chat always keeps */
const MIN_PANEL_WIDTH = 200;
const MIN_CENTER_WIDTH = 360;

/** Bound a panel width so the central chat keeps at least MIN_CENTER_WIDTH. */
function clampWidth(width: number, otherPanelWidth: number): number {
  const maxAllowed = Math.max(MIN_PANEL_WIDTH, window.innerWidth - otherPanelWidth - MIN_CENTER_WIDTH);
  return Math.max(MIN_PANEL_WIDTH, Math.min(maxAllowed, width));
}

export function usePanelLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  // Saved widths apply to every session (resizing saves on release), clamped
  // in case the window is narrower than when they were saved.
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampWidth(getPanelWidth("left", DEFAULT_LEFT_WIDTH), 0),
  );
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"dict" | "content" | "analysis" | "memos">("content");
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    clampWidth(getPanelWidth("right", DEFAULT_RIGHT_WIDTH), getPanelWidth("left", DEFAULT_LEFT_WIDTH)),
  );

  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>(null);

  const isMobile = useCallback(() => window.innerWidth <= 768, []);

  // Drag-to-resize sidebar
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      document.body.classList.add("is-resizing-panels");

      const onMouseMove = (ev: MouseEvent) => {
        const currentWidth = startWidth + ev.clientX - startX;
        
        if (currentWidth < 140) {
          // Visual cue for collapse: set width to 0
          setSidebarWidth(0);
        } else {
          setSidebarWidth(clampWidth(currentWidth, rightPanelOpen ? rightSidebarWidth : 0));
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.classList.remove("is-resizing-panels");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        const finalWidth = startWidth + ev.clientX - startX;
        if (finalWidth < 140) {
          setSidebarOpen(false);
          setSidebarWidth(startWidth); // Reopen at the width it had before the drag
        } else {
          const activeRightWidth = rightPanelOpen ? rightSidebarWidth : 0;
          setPanelWidth("left", clampWidth(finalWidth, activeRightWidth));
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth, rightPanelOpen, rightSidebarWidth],
  );

  // Right sidebar drag resize
  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rightSidebarWidth;
      document.body.classList.add("is-resizing-panels");

      const onMouseMove = (ev: MouseEvent) => {
        const currentWidth = startWidth - (ev.clientX - startX);

        if (currentWidth < 140) {
          setRightSidebarWidth(0);
        } else {
          setRightSidebarWidth(clampWidth(currentWidth, sidebarOpen ? sidebarWidth : 0));
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.classList.remove("is-resizing-panels");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        const finalWidth = startWidth - (ev.clientX - startX);
        if (finalWidth < 140) {
          setRightPanelOpen(false);
          setRightSidebarWidth(startWidth); // Reopen at the width it had before the drag
        } else {
          const activeLeftWidth = sidebarOpen ? sidebarWidth : 0;
          setPanelWidth("right", clampWidth(finalWidth, activeLeftWidth));
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [rightSidebarWidth, sidebarOpen, sidebarWidth],
  );

  // Panel toggle handlers (VS Code-style: click same = close, click different = switch)
  const toggleNavigator = useCallback(() => {
    setSidebarOpen((v) => {
      const nextVal = !v;
      if (nextVal && window.innerWidth <= 1024) {
        setRightPanelOpen(false);
      }
      return nextVal;
    });
  }, []);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      setRightPanelOpen(false);
    } else {
      setRightPanelOpen(true);
      if (window.innerWidth <= 1024) {
        setSidebarOpen(false);
      }
    }
  }, [rightPanelOpen]);

  const cssVars = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--right-sidebar-width": `${rightSidebarWidth}px`,
  } as React.CSSProperties;

  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    rightPanelOpen,
    setRightPanelOpen,
    rightTab,
    setRightTab,
    rightSidebarWidth,

    scrollDirection,
    setScrollDirection,
    isMobile,
    handleResizeStart,
    handleRightResizeStart,
    toggleNavigator,
    toggleRightPanel,
    cssVars,
  };
}
