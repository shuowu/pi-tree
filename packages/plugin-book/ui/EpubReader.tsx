import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SelectionToolbar } from "@pi-tree/ui";
import { ChevronLeft, ChevronRight, List, Minus, Plus, X } from "lucide-react";
import { isNoteElement, noteBlock, processChapter, type ProcessedChapter } from "./epub-html.js";
import "./EpubReader.css";

export interface EpubTocEntry {
  title: string;
  level: number;
  /** Zip path, optionally with a #fragment */
  href: string;
}

export interface EpubInfo {
  title?: string;
  spine: string[];
  toc: EpubTocEntry[];
}

export interface EpubReaderProps {
  sourceId: string;
  info: EpubInfo;
  onDefine?: (text: string, context?: string) => void;
  fetchText: (sourceId: string, path: string) => Promise<string>;
  fileUrl: (sourceId: string, path: string) => string;
}

interface SavedPosition {
  path: string;
  ratio: number;
}

interface NotePopover {
  html: string;
  top: number;
  left: number;
  width: number;
  /** Open upward when the link sits near the bottom of the panel */
  above: boolean;
}

const FONT_KEY = "pi-tree:book-font-scale";
const posKey = (sourceId: string) => `pi-tree:book-pos:${sourceId}`;
const FONT_MIN = 0.85;
const FONT_MAX = 1.6;

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — position just won't persist */
  }
}

function splitTarget(target: string): [string, string] {
  const i = target.indexOf("#");
  return i >= 0 ? [target.slice(0, i), target.slice(i + 1)] : [target, ""];
}

export function EpubReader({ sourceId, info, onDefine, fetchText, fileUrl }: EpubReaderProps) {
  const { spine, toc } = info;

  const [index, setIndex] = useState(() => {
    const saved = readStorage<SavedPosition>(posKey(sourceId));
    const i = saved ? spine.indexOf(saved.path) : -1;
    return i >= 0 ? i : 0;
  });
  const [chapter, setChapter] = useState<ProcessedChapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [fontScale, setFontScale] = useState(() => readStorage<number>(FONT_KEY) ?? 1);
  const [note, setNote] = useState<NotePopover | null>(null);
  const [progress, setProgress] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef(new Map<string, Promise<ProcessedChapter>>());
  /** Where to land once the next chapter renders: a fragment id, a scroll ratio, or the top */
  const landingRef = useRef<{ frag?: string; ratio?: number } | null>(
    (() => {
      const saved = readStorage<SavedPosition>(posKey(sourceId));
      return saved && spine.includes(saved.path) ? { ratio: saved.ratio } : null;
    })(),
  );

  const loadChapter = useCallback(
    (path: string): Promise<ProcessedChapter> => {
      const cache = cacheRef.current;
      let entry = cache.get(path);
      if (!entry) {
        entry = fetchText(sourceId, path).then((raw) =>
          processChapter(raw, path, (p) => fileUrl(sourceId, p)),
        );
        entry.catch(() => cache.delete(path));
        cache.set(path, entry);
      }
      return entry;
    },
    [sourceId, fetchText, fileUrl],
  );

  // Load the current chapter, prefetch the next
  useEffect(() => {
    const path = spine[index];
    if (!path) return;
    let cancelled = false;
    setError(null);
    setNote(null);
    loadChapter(path)
      .then((c) => !cancelled && setChapter(c))
      .catch(() => !cancelled && setError("Failed to load this chapter."));
    if (spine[index + 1]) loadChapter(spine[index + 1]).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [index, spine, loadChapter]);

  // Land at the requested spot after a chapter renders
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !chapter) return;
    const landing = landingRef.current;
    landingRef.current = null;
    if (landing?.frag) {
      const el = body.querySelector(`[id="${CSS.escape(landing.frag)}"]`);
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
    }
    if (landing?.ratio) {
      body.scrollTop = landing.ratio * (body.scrollHeight - body.clientHeight);
    } else {
      body.scrollTop = 0;
    }
  }, [chapter]);

  // Track progress + remember position
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      const max = body.scrollHeight - body.clientHeight;
      const ratio = max > 0 ? body.scrollTop / max : 0;
      setProgress(ratio);
      setNote(null);
      clearTimeout(timer);
      timer = setTimeout(() => writeStorage(posKey(sourceId), { path: spine[index], ratio }), 300);
    };
    onScroll();
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      body.removeEventListener("scroll", onScroll);
    };
  }, [sourceId, spine, index, chapter]);

  useEffect(() => writeStorage(FONT_KEY, fontScale), [fontScale]);

  const goTo = useCallback(
    (target: string) => {
      const [path, frag] = splitTarget(target);
      const i = path ? spine.indexOf(path) : index;
      if (i < 0) return;
      setShowToc(false);
      if (i === index && chapter) {
        if (frag) {
          bodyRef.current
            ?.querySelector(`[id="${CSS.escape(frag)}"]`)
            ?.scrollIntoView({ block: "start" });
        } else {
          bodyRef.current?.scrollTo(0, 0);
        }
        return;
      }
      landingRef.current = frag ? { frag } : null;
      setIndex(i);
    },
    [spine, index, chapter],
  );

  const goRelative = useCallback(
    (delta: number) => {
      const i = index + delta;
      if (i < 0 || i >= spine.length) return;
      landingRef.current = null;
      setShowToc(false);
      setIndex(i);
    },
    [index, spine.length],
  );

  /** Find the element a link points at — in the rendered chapter or another one */
  const resolveTarget = useCallback(
    async (target: string): Promise<Element | null> => {
      const [path, frag] = splitTarget(target);
      if (!frag) return null;
      if (!path || path === spine[index]) {
        return bodyRef.current?.querySelector(`[id="${CSS.escape(frag)}"]`) ?? null;
      }
      try {
        const other = await loadChapter(path);
        const holder = document.createElement("div");
        holder.innerHTML = other.html;
        return holder.querySelector(`[id="${CSS.escape(frag)}"]`);
      } catch {
        return null;
      }
    },
    [spine, index, loadChapter],
  );

  const handleClick = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-target]");
      if (!link) return;
      e.preventDefault();
      const target = link.getAttribute("data-target")!;
      const el = await resolveTarget(target);
      if (el && (link.hasAttribute("data-note") || isNoteElement(el))) {
        const view = viewRef.current!.getBoundingClientRect();
        const rect = link.getBoundingClientRect();
        const width = Math.min(360, view.width - 32);
        const left = Math.min(Math.max(rect.left - view.left - width / 2, 16), view.width - width - 16);
        const above = rect.bottom - view.top > view.height * 0.6;
        const top = above ? rect.top - view.top - 8 : rect.bottom - view.top + 8;
        setNote({ html: noteBlock(el).innerHTML, top, left, width, above });
        return;
      }
      goTo(target);
    },
    [resolveTarget, goTo],
  );

  // Escape closes popovers / TOC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setNote(null);
      setShowToc(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tocByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of toc) {
      const [path] = splitTarget(entry.href);
      if (!map.has(path)) map.set(path, entry.title);
    }
    return map;
  }, [toc]);

  const currentPath = spine[index];
  const title = tocByPath.get(currentPath) ?? chapter?.heading ?? `Section ${index + 1}`;
  const tocEntries: EpubTocEntry[] =
    toc.length > 0 ? toc : spine.map((href, i) => ({ title: `Section ${i + 1}`, level: 0, href }));
  const minLevel = Math.min(...tocEntries.map((t) => t.level));
  const activeTocIdx = tocEntries.findIndex((t) => splitTarget(t.href)[0] === currentPath);
  const overall = spine.length > 0 ? ((index + progress) / spine.length) * 100 : 0;

  const nextTitle = spine[index + 1]
    ? tocByPath.get(spine[index + 1]) ?? `Section ${index + 2}`
    : null;

  return (
    <div className="epub-reader" ref={viewRef}>
      <div className="epub-reader-header">
        <button
          className={`epub-reader-icon-btn ${showToc ? "active" : ""}`}
          onClick={() => setShowToc((v) => !v)}
          title="Contents"
        >
          <List size={16} />
        </button>
        <span className="epub-reader-title" title={title}>
          {title}
        </span>
        <div className="epub-reader-font">
          <button
            className="epub-reader-icon-btn"
            onClick={() => setFontScale((s) => Math.max(FONT_MIN, +(s - 0.1).toFixed(2)))}
            disabled={fontScale <= FONT_MIN}
            title="Smaller text"
          >
            <Minus size={14} />
          </button>
          <span className="epub-reader-font-label">Aa</span>
          <button
            className="epub-reader-icon-btn"
            onClick={() => setFontScale((s) => Math.min(FONT_MAX, +(s + 0.1).toFixed(2)))}
            disabled={fontScale >= FONT_MAX}
            title="Larger text"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="epub-reader-progress" aria-hidden>
        <div style={{ width: `${overall}%` }} />
      </div>

      {showToc && (
        <div className="epub-reader-toc">
          {info.title && <div className="epub-reader-toc-book">{info.title}</div>}
          {tocEntries.map((entry, i) => (
            <button
              key={`${entry.href}-${i}`}
              className={`epub-reader-toc-item ${i === activeTocIdx ? "current" : ""}`}
              style={{ paddingLeft: `${12 + Math.min(entry.level - minLevel, 3) * 16}px` }}
              onClick={() => goTo(entry.href)}
            >
              {entry.title}
            </button>
          ))}
        </div>
      )}

      <div
        ref={bodyRef}
        className="epub-reader-body"
        style={{ display: showToc ? "none" : undefined }}
      >
        {error ? (
          <div className="epub-reader-status">{error}</div>
        ) : !chapter ? (
          <div className="epub-reader-status">Loading…</div>
        ) : (
          <>
            <article
              className="epub-reader-text"
              style={{ fontSize: `${fontScale}rem` }}
              onClick={handleClick}
              onKeyDown={(e) => e.key === "Enter" && handleClick(e)}
              dangerouslySetInnerHTML={{ __html: chapter.html }}
            />
            <div className="epub-reader-chapter-end">
              {nextTitle ? (
                <button className="epub-reader-next" onClick={() => goRelative(1)}>
                  <span className="epub-reader-next-label">Next</span>
                  <span className="epub-reader-next-title">{nextTitle}</span>
                  <ChevronRight size={16} />
                </button>
              ) : (
                <span className="epub-reader-status">End of book</span>
              )}
            </div>
          </>
        )}
        {onDefine && <SelectionToolbar containerRef={bodyRef} onDefine={onDefine} />}
      </div>

      <div className="epub-reader-footer">
        <button
          className="epub-reader-nav-btn"
          onClick={() => goRelative(-1)}
          disabled={index === 0}
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="epub-reader-pos">
          {index + 1} / {spine.length} · {Math.round(overall)}%
        </span>
        <button
          className="epub-reader-nav-btn"
          onClick={() => goRelative(1)}
          disabled={index >= spine.length - 1}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>

      {note && (
        <>
          <div className="epub-reader-note-backdrop" onClick={() => setNote(null)} />
          <div
            className={`epub-reader-note ${note.above ? "above" : ""}`}
            style={{ top: note.top, left: note.left, width: note.width }}
          >
            <button className="epub-reader-note-close" onClick={() => setNote(null)} title="Close">
              <X size={12} />
            </button>
            <div dangerouslySetInnerHTML={{ __html: note.html }} />
          </div>
        </>
      )}
    </div>
  );
}
