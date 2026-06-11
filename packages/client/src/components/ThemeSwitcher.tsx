import { useTheme } from "../ThemeContext";
import { THEMES } from "../theme-data";
import type { ThemeId } from "../theme-types";
import { Check } from "lucide-react";
import "./ThemeSwitcher.css";

interface ThemeSwitcherProps {
  /** Render as compact row (for settings modal) vs inline chips (for header) */
  variant?: "grid" | "inline";
}

export function ThemeSwitcher({ variant = "grid" }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`theme-switcher theme-switcher--${variant}`}>
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            className={`theme-swatch${active ? " theme-swatch--active" : ""}`}
            onClick={() => setTheme(t.id as ThemeId)}
            title={t.label}
            aria-pressed={active}
          >
            <span
              className="theme-swatch-preview"
              style={{
                background: t.swatch,
                boxShadow: active ? `0 0 0 2px ${t.accentSwatch}` : undefined,
              }}
            >
              <span
                className="theme-swatch-accent"
                style={{ background: t.accentSwatch }}
              />
              {active && (
                <span className="theme-swatch-check">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="theme-swatch-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
