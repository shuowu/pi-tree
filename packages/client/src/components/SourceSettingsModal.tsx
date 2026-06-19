import { useState } from "react";
import { X, Trash } from "lucide-react";
import type { Source } from "@pi-tree/shared";
import { getSourceTypeConfig } from "../source-types";
import { updateSource, deleteSource } from "../api";
import "./SourceSettingsModal.css";

interface SourceSettingsModalProps {
  source: Source;
  onClose: () => void;
}

export function SourceSettingsModal({ source, onClose }: SourceSettingsModalProps) {
  const config = getSourceTypeConfig(source.type);
  
  const customFields = config.addSource?.fields?.filter(
    (f) => f.key !== "title" && f.key !== "author" && f.key !== "year"
  ) || [];

  // Local state for editing metadata
  const [title, setTitle] = useState(source.title);
  const [author, setAuthor] = useState(source.author);
  const [year, setYear] = useState(source.year ? String(source.year) : "");
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of customFields) {
      const key = f.metadataKey || f.key;
      const val = source.metadata?.[key];
      initial[f.key] = val != null ? String(val) : "";
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const metadataUpdates: Record<string, unknown> = {};
      for (const field of customFields) {
        const val = customValues[field.key];
        const key = field.metadataKey || field.key;
        if (field.type === "number") {
          metadataUpdates[key] = val ? parseInt(val, 10) : null;
        } else {
          metadataUpdates[key] = val.trim();
        }
      }

      await updateSource(source.id, {
        title: title.trim(),
        author: author.trim(),
        year: year ? parseInt(year, 10) : undefined,
        metadata: Object.keys(metadataUpdates).length > 0 ? metadataUpdates : undefined,
      });
      window.location.reload();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setSaveError(errMsg || "Failed to update source");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSource = async () => {
    if (!confirm(`Are you sure you want to permanently delete this ${config.label}? All transcript data, outline, and conversations associated with it will be lost forever.`)) return;
    try {
      await deleteSource(source.id);
      window.location.href = "/";
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      alert(errMsg || "Failed to delete source");
    }
  };

  return (
    <div className="source-settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="source-settings-modal">
        <header className="source-settings-header">
          <h2>{config.label} Settings</h2>
          <button className="source-settings-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </header>

        <div className="source-settings-body">
          <form className="source-settings-form" onSubmit={handleSave}>
            <div className="source-settings-field">
              <label htmlFor="edit-title">Title</label>
              <input
                id="edit-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={saving}
              />
            </div>
            <div className="source-settings-field-group">
              <div className="source-settings-field">
                <label htmlFor="edit-author">Author</label>
                <input
                  id="edit-author"
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="source-settings-field">
                <label htmlFor="edit-year">Year</label>
                <input
                  id="edit-year"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            {customFields.map((field) => (
              <div className="source-settings-field" key={field.key}>
                <label htmlFor={`edit-${source.type}-${field.key}`}>
                  {field.label}
                </label>
                <input
                  id={`edit-${source.type}-${field.key}`}
                  type={field.type ?? "text"}
                  value={customValues[field.key] ?? ""}
                  onChange={(e) =>
                    setCustomValues((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                  disabled={saving}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
            <div className="source-settings-form-actions">
              <button type="submit" className="save-btn" disabled={saving}>
                {saving ? "Saving..." : "Save Metadata"}
              </button>
            </div>
            {saveError && <div className="source-settings-error">{saveError}</div>}
          </form>

          {source.source !== "system" && (
            <>
              <hr className="source-settings-divider" />
              <div className="source-settings-section danger-zone">
                <div className="source-settings-section-info">
                  <h3>Danger Zone</h3>
                  <p>
                    Permanently remove this {config.label} and all associated sessions, chat history, and analysis. This action is irreversible.
                  </p>
                </div>
                <button type="button" className="source-settings-action-btn delete-source-btn" onClick={handleDeleteSource}>
                  <Trash size={14} /> Delete {config.label}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
