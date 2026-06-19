/**
 * Pi-Tree Client Plugin System (PayloadCMS-style)
 *
 * Each plugin is a factory function that returns a ClientPlugin descriptor.
 * All plugins are registered in pi-tree.config.ts — the single source of truth
 * for what's installed. The framework reads the config and wires UI automatically.
 */
import type { ComponentType } from "react";
import type { ClientPlugin, ContentPanelProps, AddSourceFormProps, SourceCardProps } from "@pi-tree/ui";

export type { ClientPlugin };

/** Resolved app config after processing all plugins */
export interface ResolvedConfig {
  plugins: ClientPlugin[];
  /** Content panels keyed by source type */
  contentPanels: Record<string, ComponentType<ContentPanelProps>>;
  /** Add-source form components keyed by source type */
  addSourceForms: Record<string, ComponentType<AddSourceFormProps>>;
  /** Custom source card components keyed by source type */
  sourceCards: Record<string, ComponentType<SourceCardProps>>;
  /** All modals contributed by plugins, keyed by name (currently unused — reserved for future plugin commands) */
  modals: Record<string, ComponentType<{ onClose: () => void }>>;
}

/** Process raw plugin list into a resolved config */
export function defineConfig(plugins: ClientPlugin[]): ResolvedConfig {
  const contentPanels: Record<string, ComponentType<ContentPanelProps>> = {};
  const addSourceForms: Record<string, ComponentType<AddSourceFormProps>> = {};
  const sourceCards: Record<string, ComponentType<SourceCardProps>> = {};
  const modals: Record<string, ComponentType<{ onClose: () => void }>> = {};

  for (const plugin of plugins) {
    if (plugin.contentPanel) {
      contentPanels[plugin.sourceType] = plugin.contentPanel;
    }
    if (plugin.addSourceForm) {
      addSourceForms[plugin.sourceType] = plugin.addSourceForm;
    }
    if (plugin.sourceCard) {
      sourceCards[plugin.sourceType] = plugin.sourceCard;
    }
    if (plugin.modals) {
      Object.assign(modals, plugin.modals);
    }
  }

  return { plugins, contentPanels, addSourceForms, sourceCards, modals };
}
