import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, ChevronUp, Check } from "lucide-react";
import "./styles/ModelPicker.css";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
}

interface ModelPickerProps {
  currentModel: string;
  models?: ModelInfo[];
  onModelChange?: (modelId: string) => void;
  isLoading?: boolean;
}

export function ModelPicker({
  currentModel,
  models,
  onModelChange,
  isLoading,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleSelect = useCallback(
    (modelId: string) => {
      if (modelId === currentModel) {
        setOpen(false);
        return;
      }
      onModelChange?.(modelId);
      setOpen(false);
    },
    [currentModel, onModelChange],
  );

  // If no onModelChange provided, render as a static badge
  if (!onModelChange) {
    return (
      <span className="pit-model-picker-static">
        <Cpu size={11} /> {currentModel}
      </span>
    );
  }

  // Group models by provider
  const grouped = (models ?? []).reduce<Record<string, ModelInfo[]>>(
    (acc, model) => {
      const key = model.provider || "other";
      if (!acc[key]) acc[key] = [];
      acc[key].push(model);
      return acc;
    },
    {},
  );

  const providerKeys = Object.keys(grouped).sort();

  return (
    <div className="pit-model-picker" ref={containerRef}>
      <button
        className="pit-model-picker-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={isLoading}
      >
        <Cpu size={11} />
        {currentModel}
        <ChevronUp size={10} className="pit-model-picker-chevron" />
      </button>

      {open && providerKeys.length > 0 && (
        <div className="pit-model-picker-dropdown" role="listbox">
          {providerKeys.map((provider) => (
            <div key={provider}>
              <div className="pit-model-picker-group">{provider}</div>
              {grouped[provider].map((model) => {
                const isSelected = model.id === currentModel;
                return (
                  <button
                    key={model.id}
                    className={`pit-model-picker-item${isSelected ? " pit-model-picker-item--selected" : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(model.id)}
                  >
                    <span className="pit-model-picker-item-name">
                      {model.name || model.id}
                    </span>
                    {isSelected && (
                      <Check size={12} className="pit-model-picker-check" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
