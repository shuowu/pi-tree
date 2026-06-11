import type { ThemeId } from "./theme-types";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  swatch: string;         // preview color (bg-primary)
  accentSwatch: string;   // preview accent dot
}

export const THEMES: ThemeMeta[] = [
  { id: "sepia",        label: "Kindle Sepia",  swatch: "#f3e8d2", accentSwatch: "#7a5a38" },
  { id: "dark-ink",     label: "Dark Ink",      swatch: "#1a1b1e", accentSwatch: "#d4a574" },
  { id: "moonlight",    label: "Moonlight",     swatch: "#1e2030", accentSwatch: "#8aadf4" },
  { id: "paper-white",  label: "Paper White",   swatch: "#fafaf8", accentSwatch: "#4a7c59" },
  { id: "rosewood",     label: "Rosewood",      swatch: "#1f1518", accentSwatch: "#c9826b" },
  { id: "nord",         label: "Nord",          swatch: "#2e3440", accentSwatch: "#88c0d0" },
];
