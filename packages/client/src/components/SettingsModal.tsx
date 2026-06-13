import { useEffect, useState } from "react";
import { X, Loader2, Save, Check, Info, Server } from "lucide-react";
import { fetchModels, saveServerConfig, fetchServerConfig } from "../api";
import type { ModelInfo, ProviderInfo } from "../api";
import { ThemeSwitcher } from "./ThemeSwitcher";
import "./SettingsModal.css";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Model selection state
  const [readingModel, setReadingModel] = useState("");
  const [lookupModel, setLookupModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [modelsData, configData] = await Promise.all([
          fetchModels(),
          fetchServerConfig(true),
        ]);
        setModels(modelsData.models);
        setProviders(modelsData.providers ?? []);
        setReadingModel(configData.readingModel || modelsData.currentModel || "");
        setLookupModel(configData.lookupModel || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load configuration");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    if (!readingModel) {
      setError("Please select a reading model");
      setSaving(false);
      return;
    }

    try {
      await saveServerConfig({
        readingModel,
        lookupModel: lookupModel || readingModel,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Group models by provider for the dropdown
  const modelsByProvider = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  const renderModelSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    helpText: string,
  ) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Select a model…</option>}
        {Object.entries(modelsByProvider).map(([provider, pModels]) => (
          <optgroup key={provider} label={provider}>
            {pModels.map((m) => (
              <option key={`${m.provider}-${m.id}`} value={m.id}>
                {m.name}{m.reasoning ? " ✦" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="form-help">{helpText}</p>
    </div>
  );

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="settings-close" onClick={onClose} aria-label="Close settings">
          <X size={16} />
        </button>

        <div className="settings-header">
          <h2>Settings</h2>
          <p>Appearance and default AI model.</p>
        </div>

        {/* ── Appearance section (client-only, no loading gate) ── */}
        <div className="settings-section">
          <h3 className="settings-section-title">Theme</h3>
          <ThemeSwitcher variant="grid" />
        </div>

        <div className="settings-divider" />

        <h3 className="settings-section-title">Default Model</h3>

        {loading ? (
          <div className="settings-loading">
            <Loader2 size={32} className="spinner" />
            <p>Loading available models…</p>
          </div>
        ) : models.length === 0 ? (
          <div className="settings-info-box">
            <Info size={16} />
            <div>
              <p><strong>No models available.</strong></p>
              <p style={{ marginTop: 8 }}>
                Configure a provider via environment variables (<code>PI_PROVIDER</code>, <code>PI_API_KEY</code>, <code>PI_MODEL</code>)
                or create a <code>models.json</code> file in your data directory.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="settings-form">
            {error && (
              <div className="settings-error-alert">
                <Info size={16} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="settings-success-alert">
                <Check size={16} />
                <span>Default model updated. New sessions will use this model.</span>
              </div>
            )}

            {renderModelSelect(
              "settings-reading-model",
              "Reading Model",
              readingModel,
              setReadingModel,
              "Used for conversations, reading sessions, and analysis.",
            )}

            {renderModelSelect(
              "settings-lookup-model",
              "Lookup Model",
              lookupModel,
              setLookupModel,
              "Used for quick dictionary lookups. Defaults to the reading model if not set.",
            )}

            {/* Provider info */}
            {providers.length > 0 && (
              <div className="settings-provider-info">
                <Server size={14} />
                <div>
                  <span className="settings-provider-label">Providers</span>
                  <div className="settings-provider-list">
                    {providers.map((p) => (
                      <span key={p.name} className="settings-provider-chip">
                        {p.name}
                        <span className="settings-provider-source">{p.source}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="settings-info-box">
              <Info size={16} />
              <p>
                This sets the default model for new sessions. Individual sessions can override the model
                via the model picker in the chat input.
                To add providers or models, edit <code>models.json</code> in your data directory or set environment variables.
              </p>
            </div>

            <div className="settings-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Save
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
