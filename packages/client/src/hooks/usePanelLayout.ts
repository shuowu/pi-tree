import { useCallback, useState } from "react";
import type { ScrollDirection } from "../utils/useScrollDirection";

export function usePanelLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"dict" | "book">("dict");
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [showBookSettings, setShowBookSettings] = useState(false);
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
        
        // Ensure central layout gets at least 360px
        const activeRightWidth = rightPanelOpen ? rightSidebarWidth : 0;
        const maxAllowed = Math.max(200, window.innerWidth - activeRightWidth - 360);

        if (currentWidth < 140) {
          // Visual cue for collapse: set width to 0
          setSidebarWidth(0);
        } else {
          const boundedWidth = Math.max(200, Math.min(maxAllowed, currentWidth));
          setSidebarWidth(boundedWidth);
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
          setSidebarWidth(300); // Reset for next open
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

        // Ensure central layout gets at least 360px
        const activeLeftWidth = sidebarOpen ? sidebarWidth : 0;
        const maxAllowed = Math.max(200, window.innerWidth - activeLeftWidth - 360);

        if (currentWidth < 140) {
          setRightSidebarWidth(0);
        } else {
          const boundedWidth = Math.max(200, Math.min(maxAllowed, currentWidth));
          setRightSidebarWidth(boundedWidth);
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
          setRightSidebarWidth(320); // Reset for next open
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

  const toggleDict = useCallback(() => {
    if (rightPanelOpen && rightTab === "dict") {
      setRightPanelOpen(false);
    } else {
      setRightPanelOpen(true);
      setRightTab("dict");
      if (window.innerWidth <= 1024) {
        setSidebarOpen(false);
      }
    }
  }, [rightPanelOpen, rightTab]);

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
    showBookSettings,
    setShowBookSettings,
    scrollDirection,
    setScrollDirection,
    isMobile,
    handleResizeStart,
    handleRightResizeStart,
    toggleNavigator,
    toggleDict,
    cssVars,
  };
}
