import { useEffect, useState } from "react";
import { X, Loader2, Save, AlertCircle, Check, Info } from "lucide-react";
import { fetchServerConfig, saveServerConfig } from "../api";
import "./SettingsModal.css";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Config fields state
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [readingModel, setReadingModel] = useState("");
  const [lookupModel, setLookupModel] = useState("");

  useEffect(() => {
    async function loadConfig() {
      try {
        setLoading(true);
        setError(null);
        const cfg = await fetchServerConfig(true); // force reload

        setProvider(cfg.provider || "");
        setApiKey(cfg.apiKey || "");
        setBaseUrl(cfg.baseUrl || "");
        setReadingModel(cfg.readingModel || "");
        setLookupModel(cfg.lookupModel || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load configuration");
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const activeProvider = provider.trim();

    if (!activeProvider) {
      setError("Please specify a provider name");
      setSaving(false);
      return;
    }

    if (!readingModel.trim()) {
      setError("Reading model name is required");
      setSaving(false);
      return;
    }

    try {
      await saveServerConfig({
        provider: activeProvider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        readingModel: readingModel.trim(),
        lookupModel: lookupModel.trim() || readingModel.trim(),
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
      }, 3000);
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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="settings-close" onClick={onClose} aria-label="Close settings">
          <X size={16} />
        </button>

        <div className="settings-header">
          <h2>Global AI Settings</h2>
          <p>Configure dynamic model parameters, API credentials, and endpoint targets.</p>
        </div>

        {loading ? (
          <div className="settings-loading">
            <Loader2 size={32} className="spinner" />
            <p>Retrieving server configuration...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="settings-form">
            {error && (
              <div className="settings-error-alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="settings-success-alert">
                <Check size={16} />
                <span>Configuration saved successfully! Changes applied immediately.</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="settings-provider">LLM Provider</label>
              <input
                id="settings-provider"
                type="text"
                placeholder="e.g. zai, openai, anthropic, zhipu"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="settings-api-key">API Key</label>
              <input
                id="settings-api-key"
                type="password"
                placeholder={apiKey ? "•••••••• (Saved)" : "Enter API credential token"}
                value={apiKey.includes("•") ? "" : apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="form-help">
                {apiKey
                  ? "A credential token is saved. Enter a new one to replace it, or leave empty to keep existing."
                  : "Required for authenticated cloud providers (OpenAI, Anthropic, Z.ai, Zhipu, etc.)."}
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="settings-base-url">Base URL (Optional)</label>
              <input
                id="settings-base-url"
                type="text"
                placeholder="e.g. https://api.openai.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="form-help">
                Optional custom endpoint target. Leave blank for provider defaults.
              </p>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="settings-reading-model">Reading Model</label>
                <input
                  id="settings-reading-model"
                  type="text"
                  placeholder="e.g. gpt-4o"
                  value={readingModel}
                  onChange={(e) => setReadingModel(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="settings-lookup-model">Lookup Model</label>
                <input
                  id="settings-lookup-model"
                  type="text"
                  placeholder="e.g. gpt-4o-mini"
                  value={lookupModel}
                  onChange={(e) => setLookupModel(e.target.value)}
                />
              </div>
            </div>

            <div className="settings-info-box">
              <Info size={16} />
              <p>
                Dynamic models configure how Pi Reader interacts with the AI. The <strong>Reading Model</strong> is used for core book chats and outlines. The <strong>Lookup Model</strong> handles fast dictionary operations.
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
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Save Configuration
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
