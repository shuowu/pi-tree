import { useCallback, useRef, useState } from "react";
import type { AddSourceFormProps } from "@pi-tree/ui";

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

/**
 * Book-specific add-source form with drag-and-drop file upload.
 * Registered as the `addSourceForm` for the book plugin.
 */
export function BookAddSourceForm({ onSuccess, onError }: AddSourceFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      onError(`Unsupported format. Please use ${ACCEPTED_EXTENSIONS.join(", ")}`);
      return;
    }
    setFile(f);
    const meta = guessMetaFromFilename(f.name);
    setTitle(prev => prev || meta.title);
    setAuthor(prev => prev || meta.author);
  }, [onError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const canSubmit = !submitting && !!title.trim() && !!author.trim() && !!file;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim());
      formData.append("author", author.trim());
      if (year) formData.append("year", year);

      const res = await fetch("/api/library/sources", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || `Upload failed: ${res.status}`);
      }
      const created: { id: string } = await res.json();
      onSuccess(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed");
      setSubmitting(false);
    }
  }, [canSubmit, file, title, author, year, onSuccess, onError]);

  return (
    <>
      {/* Drop zone */}
      <div
        className={`add-source-dropzone ${dragOver ? "drag-over" : ""} ${file ? "has-file" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
      >
        <div className="add-source-dropzone-icon">
          {file ? "✓" : "↑"}
        </div>
        <span className="add-source-dropzone-text">
          {file ? file.name : "Drop your book here or click to browse"}
        </span>
        {!file && (
          <span className="add-source-dropzone-hint">
            {ACCEPTED_EXTENSIONS.join(", ")}
          </span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {/* Fields */}
      <div className="add-source-form">
        <div className="add-source-field">
          <label htmlFor="book-title">Title</label>
          <input
            id="book-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Book title"
          />
        </div>
        <div className="add-source-field">
          <label htmlFor="book-author">Author</label>
          <input
            id="book-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author name"
          />
        </div>
        <div className="add-source-field">
          <label htmlFor="book-year">Year (optional)</label>
          <input
            id="book-year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Publication year"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="add-source-actions">
        <button
          className="add-source-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? "Uploading…" : "Upload Book"}
        </button>
      </div>
    </>
  );
}
