import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createSource } from "../api";
import { SOURCE_TYPE_CONFIGS, type SourceTypeConfig } from "../source-types";
import "./AddSourceModal.css";

// --- Generic Form (for plugins without a custom component) ---

interface GenericFormProps {
  config: SourceTypeConfig;
  sourceType: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

function GenericAddSourceForm({ config, sourceType, onSuccess, onError }: GenericFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const addSource = config.addSource!;
  const fields = useMemo(() => addSource.fields ?? [], [addSource]);
  const requiredFields = fields.filter(f => f.required);
  const requiredSatisfied = requiredFields.every(f => values[f.key]?.trim());
  const canSubmit = !submitting && requiredSatisfied;

  const setField = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Collect metadata from fields with metadataKey
      const metadata: Record<string, unknown> = {};
      for (const field of fields) {
        if (field.metadataKey && values[field.key]?.trim()) {
          metadata[field.metadataKey] = values[field.key].trim();
        }
      }

      await createSource({
        title: values.title?.trim() ?? "",
        author: values.author?.trim() || undefined,
        type: sourceType,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Creation failed");
      setSubmitting(false);
    }
  }, [canSubmit, fields, values, sourceType, onSuccess, onError]);

  // If no fields (info-only), show a placeholder
  if (fields.length === 0) {
    return (
      <div className="add-source-info">
        <p>This source type is managed automatically.</p>
      </div>
    );
  }

  return (
    <>
      <div className="add-source-form">
        {fields.map(field => (
          <div className="add-source-field" key={field.key}>
            <label htmlFor={`add-${sourceType}-${field.key}`}>
              {field.label}{!field.required && " (optional)"}
            </label>
            <input
              id={`add-${sourceType}-${field.key}`}
              type={field.type ?? "text"}
              value={values[field.key] ?? ""}
              onChange={e => setField(field.key, e.target.value)}
              placeholder={field.placeholder}
            />
          </div>
        ))}
      </div>

      <div className="add-source-actions">
        <button
          className="add-source-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="spinner" />
              Adding…
            </>
          ) : (
            `Add ${config.label}`
          )}
        </button>
      </div>
    </>
  );
}

// --- Type Picker (Step 1) ---

interface TypeEntry {
  key: string;
  config: SourceTypeConfig;
  icon: LucideIcon;
}

interface TypePickerProps {
  types: TypeEntry[];
  onSelect: (key: string) => void;
}

function TypePicker({ types, onSelect }: TypePickerProps) {
  return (
    <div className="add-source-type-grid">
      {types.map(({ key, config, icon: Icon }) => (
        <button
          key={key}
          className="add-source-type-card"
          onClick={() => onSelect(key)}
        >
          <div className="add-source-type-card-icon">
            <Icon size={22} />
          </div>
          <div className="add-source-type-card-info">
            <span className="add-source-type-card-label">{config.label}</span>
            {config.addSource?.subtitle && (
              <span className="add-source-type-card-subtitle">
                {config.addSource.subtitle}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// --- Modal Component ---

interface AddSourceModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AddSourceModal({ onClose, onSuccess }: AddSourceModalProps) {
  // Collect source types that have addSource config
  const types = useMemo(() => {
    const result: TypeEntry[] = [];
    for (const [key, config] of Object.entries(SOURCE_TYPE_CONFIGS)) {
      if (config.addSource) {
        result.push({ key, config, icon: config.icon });
      }
    }
    return result;
  }, []);

  const [selectedType, setSelectedType] = useState<string | null>(
    // Skip picker if only one type
    types.length === 1 ? types[0].key : null,
  );
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = selectedType
    ? types.find(t => t.key === selectedType)
    : null;

  const handleBack = useCallback(() => {
    setSelectedType(null);
    setError(null);
  }, []);

  const handleSelect = useCallback((key: string) => {
    setSelectedType(key);
    setError(null);
  }, []);

  // Keyboard / backdrop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedType && types.length > 1) {
          handleBack();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, selectedType, types.length, handleBack]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const handleSuccess = useCallback(() => {
    onSuccess();
  }, [onSuccess]);

  // No types available
  if (types.length === 0) {
    return (
      <div className="add-source-overlay" onClick={handleBackdropClick}>
        <div className="add-source-modal">
          <button className="add-source-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
          <div className="add-source-header">
            <h2>No Source Types Available</h2>
            <p>No plugins have registered add-source capabilities.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="add-source-overlay" onClick={handleBackdropClick}>
      <div className="add-source-modal">
        <button className="add-source-close" onClick={onClose} title="Close">
          <X size={16} />
        </button>

        {/* Step 1: Type picker */}
        {!selectedEntry && (
          <>
            <div className="add-source-header">
              <h2>Add a Source</h2>
              <p>Choose the type of source you want to add</p>
            </div>
            <TypePicker types={types} onSelect={handleSelect} />
          </>
        )}

        {/* Step 2: Form for selected type */}
        {selectedEntry && (
          <>
            <div className="add-source-header">
              {types.length > 1 && (
                <button
                  className="add-source-back"
                  onClick={handleBack}
                  title="Back to type selection"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <h2>Add a {selectedEntry.config.label}</h2>
              <p>{selectedEntry.config.addSource?.subtitle ?? ""}</p>
            </div>

            {/* Error display */}
            {error && (
              <div className="add-source-error">
                <AlertCircle size={16} />
                <span className="add-source-error-text">{error}</span>
              </div>
            )}

            {/* Form: custom plugin component or generic fallback */}
            {selectedEntry.config.addSourceForm ? (
              <selectedEntry.config.addSourceForm
                onSuccess={handleSuccess}
                onError={handleError}
              />
            ) : (
              <GenericAddSourceForm
                config={selectedEntry.config}
                sourceType={selectedEntry.key}
                onSuccess={handleSuccess}
                onError={handleError}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
