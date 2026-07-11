import { useEffect, useState } from "react";
import { X, Loader2, Save, Check, Info, Server, GitBranch, BookOpen, Zap, AlertCircle } from "lucide-react";
import { fetchModels, saveServerConfig, fetchServerConfig, fetchDictPrompt, saveDictPrompt, testModelConnection } from "../api";
import type { ModelInfo, ProviderInfo } from "../api";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { getBranchesCollapsed, setBranchesCollapsed as saveBranchesCollapsed } from "../utils/preferences";
import "./SettingsModal.css";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [branchesCollapsed, setBranchesCollapsed] = useState(getBranchesCollapsed);

  // Model selection state
  const [readingModel, setReadingModel] = useState("");
  const [lookupModel, setLookupModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [testState, setTestState] = useState<
    Record<string, { status: "testing" | "ok" | "error"; message: string }>
  >({});

  // Dictionary prompt state
  const [dictPrompt, setDictPrompt] = useState("");
  const [dictPromptLoading, setDictPromptLoading] = useState(true);
  const [dictPromptSaving, setDictPromptSaving] = useState(false);
  const [dictPromptCustom, setDictPromptCustom] = useState(false);
  const [dictPromptDefault, setDictPromptDefault] = useState("");

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
        // Load dictionary prompt template
        try {
          const promptData = await fetchDictPrompt();
          setDictPrompt(promptData.template);
          setDictPromptCustom(promptData.isCustom);
          setDictPromptDefault(promptData.defaultTemplate);
        } catch {
          // Non-critical — dict prompt is optional
        }
        setDictPromptLoading(false);
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

  const handleTestConnection = async (id: string, model: string) => {
    if (!model) return;
    setTestState((s) => ({ ...s, [id]: { status: "testing", message: "" } }));
    const result = await testModelConnection(model);
    setTestState((s) => ({
      ...s,
      [id]: result.ok
        ? {
            status: "ok",
            message: `Connected${result.latencyMs != null ? ` · ${(result.latencyMs / 1000).toFixed(1)}s` : ""}`,
          }
        : { status: "error", message: result.error || "Connection failed" },
    }));
  };

  const renderModelSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    helpText: string,
  ) => {
    const test = testState[id];
    return (
      <div className="form-group">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // A test result is only valid for the model it ran against
            setTestState((s) => {
              const rest = { ...s };
              delete rest[id];
              return rest;
            });
          }}
        >
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
        <div className="model-test-row">
          <p className="form-help">{helpText}</p>
          <div className="model-test-controls">
            {test?.status === "ok" && (
              <span className="test-result test-result-ok" title={test.message}>
                <Check size={12} /> {test.message}
              </span>
            )}
            {test?.status === "error" && (
              <span className="test-result test-result-error" title={test.message}>
                <AlertCircle size={12} /> {test.message}
              </span>
            )}
            <button
              type="button"
              className="test-connection-btn"
              disabled={!value || test?.status === "testing"}
              onClick={() => handleTestConnection(id, value)}
            >
              {test?.status === "testing" ? (
                <><Loader2 size={12} className="spinner" /> Testing…</>
              ) : (
                <><Zap size={12} /> Test Connection</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

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

        {/* ── Chat section ── */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <GitBranch size={16} />
            Branch Previews
          </h3>
          <div className="settings-toggle-row">
            <div className="settings-toggle-info">
              <p>When collapsed, branch previews show only the header. When expanded, a preview of the conversation is shown inline.</p>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!branchesCollapsed}
                onChange={() => {
                  const next = !branchesCollapsed;
                  setBranchesCollapsed(next);
                  saveBranchesCollapsed(next);
                }}
              />
              <span className="toggle-slider" />
              <span className="toggle-label">{branchesCollapsed ? "Collapsed" : "Expanded"}</span>
            </label>
          </div>
        </div>

        <div className="settings-divider" />

        {/* ── Dictionary prompt section ── */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <BookOpen size={16} />
            Dictionary Prompt
          </h3>
          <div className="form-group">
            <label htmlFor="dict-prompt-template">Lookup prompt template</label>
            <textarea
              id="dict-prompt-template"
              value={dictPrompt}
              onChange={(e) => setDictPrompt(e.target.value)}
              rows={8}
              disabled={dictPromptLoading}
            />
            <p className="form-help">
              Placeholders: <code>{"{{term}}"}</code>, <code>{"{{context}}"}</code>, <code>{"{{bookTitle}}"}</code>, <code>{"{{#context}}...{{/context}}"}</code> (conditional block).
            </p>
            <div className="dict-prompt-actions">
              {(dictPromptCustom || dictPrompt.trim() !== dictPromptDefault.trim()) && (
                <button
                  type="button"
                  className="reset-link"
                  onClick={async () => {
                    try {
                      setDictPromptSaving(true);
                      const result = await saveDictPrompt('global', null);
                      setDictPrompt(result.defaultTemplate);
                      setDictPromptCustom(result.isCustom);
                      setDictPromptDefault(result.defaultTemplate);
                    } finally {
                      setDictPromptSaving(false);
                    }
                  }}
                  disabled={dictPromptSaving}
                >
                  Reset to Default
                </button>
              )}
              <button
                type="button"
                className="save-prompt-btn"
                disabled={dictPromptSaving || dictPromptLoading}
                onClick={async () => {
                  try {
                    setDictPromptSaving(true);
                    // If content matches default, save null to remove the override file
                    const templateToSave = dictPrompt.trim() === dictPromptDefault.trim() ? null : dictPrompt.trim();
                    const result = await saveDictPrompt('global', templateToSave);
                    setDictPromptCustom(result.isCustom);
                    setDictPromptDefault(result.defaultTemplate);
                  } catch {
                    // Could add error state here
                  } finally {
                    setDictPromptSaving(false);
                  }
                }}
              >
                {dictPromptSaving ? (
                  <><Loader2 size={12} className="spinner" /> Saving…</>
                ) : (
                  <><Save size={12} /> Save Prompt</>
                )}
              </button>
            </div>
          </div>
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
