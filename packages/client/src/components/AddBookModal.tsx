import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, X, Loader2, Check, BookOpen, ScrollText } from "lucide-react";
import { uploadSource, createSource } from "../api";
import "./AddBookModal.css";

interface AddBookModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type SourceTab = "book" | "paper";

const ACCEPTED_EXTENSIONS = [".epub", ".mobi", ".pdf", ".md"];

function guessMetaFromFilename(filename: string): { title: string; author: string } {
  const name = filename.replace(/\.(epub|mobi|pdf|md)$/i, "");

  const separators = [" - ", " — ", " – ", "_-_", " by "];
  for (const sep of separators) {
    const idx = name.indexOf(sep);
    if (idx > 0) {
      return {
        title: name.slice(0, idx).replace(/[_]/g, " ").trim(),
        author: name.slice(idx + sep.length).replace(/[_]/g, " ").trim(),
      };
    }
  }

  return { title: name.replace(/[_]/g, " ").trim(), author: "" };
}

export function AddBookModal({ onClose, onSuccess }: AddBookModalProps) {
  const [sourceType, setSourceType] = useState<SourceTab>("book");

  // Book state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paper state
  const [paperTitle, setPaperTitle] = useState("");
  const [paperAuthor, setPaperAuthor] = useState("");
  const [paperArxivId, setPaperArxivId] = useState("");
  const [paperSubmitting, setPaperSubmitting] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported format. Please use ${ACCEPTED_EXTENSIONS.join(", ")}`);
      return;
    }
    setFile(f);
    setError(null);
    const meta = guessMetaFromFilename(f.name);
    if (!title) setTitle(meta.title);
    if (!author) setAuthor(meta.author);
  }, [title, author]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const canSubmitBook = file && title.trim() && author.trim() && !uploading;

  const handleSubmitBook = useCallback(async () => {
    if (!file || !title.trim() || !author.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await uploadSource(file, {
        title: title.trim(),
        author: author.trim(),
        year: year ? Number(year) : undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }, [file, title, author, year, onSuccess]);

  const canSubmitPaper = paperTitle.trim() && !paperSubmitting;

  const handleSubmitPaper = useCallback(async () => {
    if (!paperTitle.trim()) return;
    setPaperSubmitting(true);
    setPaperError(null);
    try {
      const metadata: Record<string, unknown> = {};
      if (paperArxivId.trim()) {
        metadata.arxivId = paperArxivId.trim();
      }
      await createSource({
        title: paperTitle.trim(),
        author: paperAuthor.trim() || undefined,
        type: "paper",
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      onSuccess();
    } catch (err) {
      setPaperError(err instanceof Error ? err.message : "Creation failed");
      setPaperSubmitting(false);
    }
  }, [paperTitle, paperAuthor, paperArxivId, onSuccess]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="add-book-overlay" onClick={handleBackdropClick}>
      <div className="add-book-modal">
        <button className="add-book-close" onClick={onClose} title="Close">
          <X size={16} />
        </button>

        <div className="add-book-header">
          <h2>{sourceType === "book" ? "Add a Book" : "Add a Paper"}</h2>
          <p>
            {sourceType === "book"
              ? "Upload an EPUB, MOBI, PDF, or Markdown file"
              : "Add a paper to discuss and analyze"}
          </p>
        </div>

        {/* ── Type Tabs ── */}
        <div className="add-book-tabs">
          <button
            className={`add-book-tab ${sourceType === "book" ? "active" : ""}`}
            onClick={() => setSourceType("book")}
          >
            <BookOpen size={15} />
            Book
          </button>
          <button
            className={`add-book-tab ${sourceType === "paper" ? "active" : ""}`}
            onClick={() => setSourceType("paper")}
          >
            <ScrollText size={15} />
            Paper
          </button>
        </div>

        {/* ── Book Tab ── */}
        {sourceType === "book" && (
          <>
            <div
              className={`add-book-dropzone ${dragOver ? "drag-over" : ""} ${file ? "has-file" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="add-book-dropzone-icon">
                {file ? <Check size={24} strokeWidth={2} /> : <Upload size={24} strokeWidth={1.5} />}
              </div>
              <span className="add-book-dropzone-text">
                {file ? file.name : "Drop your book here or click to browse"}
              </span>
              {!file && (
                <span className="add-book-dropzone-hint">.epub, .mobi, .pdf, .md</span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".epub,.mobi,.pdf,.md"
                onChange={handleFileInput}
              />
            </div>

            <div className="add-book-form">
              <div className="add-book-field">
                <label htmlFor="add-book-title">Title</label>
                <input
                  id="add-book-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Book title"
                />
              </div>
              <div className="add-book-field">
                <label htmlFor="add-book-author">Author</label>
                <input
                  id="add-book-author"
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Author name"
                />
              </div>
              <div className="add-book-field">
                <label htmlFor="add-book-year">Year (optional)</label>
                <input
                  id="add-book-year"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="Publication year"
                />
              </div>
            </div>

            {error && (
              <div className="add-book-error">
                <span className="add-book-error-text">{error}</span>
                <button className="add-book-error-retry" onClick={handleSubmitBook}>
                  Retry
                </button>
              </div>
            )}

            <div className="add-book-actions">
              <button
                className="add-book-submit"
                disabled={!canSubmitBook}
                onClick={handleSubmitBook}
              >
                {uploading ? (
                  <>
                    <Loader2 size={18} className="spinner" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <FileText size={18} />
                    Upload Book
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* ── Paper Tab ── */}
        {sourceType === "paper" && (
          <>
            <div className="add-book-form">
              <div className="add-book-field">
                <label htmlFor="add-paper-title">Title</label>
                <input
                  id="add-paper-title"
                  type="text"
                  value={paperTitle}
                  onChange={(e) => setPaperTitle(e.target.value)}
                  placeholder="Paper title"
                />
              </div>
              <div className="add-book-field">
                <label htmlFor="add-paper-author">Author(s) (optional)</label>
                <input
                  id="add-paper-author"
                  type="text"
                  value={paperAuthor}
                  onChange={(e) => setPaperAuthor(e.target.value)}
                  placeholder="Author names"
                />
              </div>
              <div className="add-book-field">
                <label htmlFor="add-paper-arxiv">arXiv ID / URL (optional)</label>
                <input
                  id="add-paper-arxiv"
                  type="text"
                  value={paperArxivId}
                  onChange={(e) => setPaperArxivId(e.target.value)}
                  placeholder="e.g. 2301.07041 or https://arxiv.org/abs/2301.07041"
                />
              </div>
            </div>

            {paperError && (
              <div className="add-book-error">
                <span className="add-book-error-text">{paperError}</span>
                <button className="add-book-error-retry" onClick={handleSubmitPaper}>
                  Retry
                </button>
              </div>
            )}

            <div className="add-book-actions">
              <button
                className="add-book-submit"
                disabled={!canSubmitPaper}
                onClick={handleSubmitPaper}
              >
                {paperSubmitting ? (
                  <>
                    <Loader2 size={18} className="spinner" />
                    Adding…
                  </>
                ) : (
                  <>
                    <ScrollText size={18} />
                    Add Paper
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
