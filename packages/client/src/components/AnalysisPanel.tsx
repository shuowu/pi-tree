import { useState, useEffect, useCallback } from "react";
import { marked } from "marked";
import { FileText, ArrowLeft } from "lucide-react";
import { ConceptsPanel } from "./ConceptsPanel";
import "./AnalysisPanel.css";

const API = import.meta.env.VITE_API_URL || "/api";

interface AnalysisFile {
  name: string;
  size: number;
  modified: string;
}

/** Pretty label for known analysis files */
function fileLabel(name: string): string {
  const labels: Record<string, string> = {
    "outline.md": "Book Outline",
    "summary.md": "Summary",
    "key-ideas.md": "Key Ideas",
    "quotes.md": "Notable Quotes",
    "context.md": "Author & Context",
    "toc.json": "Table of Contents (raw)",
  };
  return labels[name] || name.replace(/[-_]/g, " ").replace(/\.\w+$/, "");
}

/** Description for known analysis files */
function fileDesc(name: string): string {
  const descs: Record<string, string> = {
    "outline.md": "Chapter-by-chapter structure, themes, and reading map",
    "summary.md": "High-level overview with key takeaways per chapter",
    "key-ideas.md": "Core ideas with evidence and applications",
    "quotes.md": "Notable passages with source locations",
    "context.md": "Author background and historical context",
    "toc.json": "Machine-readable table of contents with line numbers",
  };
  return descs[name] || "";
}

export function AnalysisPanel({ sourceId }: { sourceId: string }) {
  const [files, setFiles] = useState<AnalysisFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API}/library/sources/${sourceId}/analysis`);
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err) {
      console.error("Failed to load analysis files:", err);
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Load file content when a file is selected
  useEffect(() => {
    if (!selectedFile) return;
    let cancelled = false;
    setLoadingContent(true);

    (async () => {
      try {
        const res = await fetch(
          `${API}/library/sources/${sourceId}/analysis/${selectedFile}`,
        );
        if (!res.ok || cancelled) {
          if (!cancelled) setContent("Failed to load file.");
          return;
        }
        const text = await res.text();
        if (cancelled) return;

        if (selectedFile.endsWith(".md")) {
          setContent(await marked.parse(text));
        } else if (selectedFile.endsWith(".json")) {
          try {
            const formatted = JSON.stringify(JSON.parse(text), null, 2);
            setContent(`<pre><code>${escapeHtml(formatted)}</code></pre>`);
          } catch {
            setContent(`<pre><code>${escapeHtml(text)}</code></pre>`);
          }
        } else {
          setContent(`<pre>${escapeHtml(text)}</pre>`);
        }
      } catch {
        if (!cancelled) setContent("Failed to load file.");
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceId, selectedFile]);

  if (loading) {
    return <div className="analysis-panel-empty">Loading…</div>;
  }

  if (files.length === 0) {
    return (
      <div className="analysis-panel-empty">
        <FileText size={32} strokeWidth={1.5} />
        <p>No analysis files yet</p>
        <span className="analysis-panel-hint">
          Analysis is generated automatically when a book is uploaded, or you can
          ask the AI to analyze during a reading session.
        </span>
      </div>
    );
  }

  // --- Content view (drill-down) ---
  if (selectedFile) {
    return (
      <div className="analysis-panel">
        <div className="analysis-panel-header">
          <button
            className="analysis-back-btn"
            onClick={() => setSelectedFile(null)}
            title="Back to file list"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="analysis-header-title">{fileLabel(selectedFile)}</span>
        </div>
        {loadingContent ? (
          <div className="analysis-panel-empty">Loading…</div>
        ) : (
          <div
            className="analysis-panel-content markdown-body"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        )}
      </div>
    );
  }

  // --- File list view (layer 1) ---
  return (
    <div className="analysis-panel">
      <ConceptsPanel sourceId={sourceId} />
      <div className="analysis-file-list">
        {files.filter((f) => f.name !== "concepts.json").map((f) => (
          <button
            key={f.name}
            className="analysis-file-item"
            onClick={() => setSelectedFile(f.name)}
          >
            <FileText size={16} className="analysis-file-icon" />
            <div className="analysis-file-info">
              <span className="analysis-file-label">{fileLabel(f.name)}</span>
              {fileDesc(f.name) && (
                <span className="analysis-file-desc">{fileDesc(f.name)}</span>
              )}
            </div>
            <span className="analysis-file-size">{formatSize(f.size)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
