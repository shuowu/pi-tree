/**
 * DiscoverRegistry — collects DiscoverProviders registered by plugins at setup().
 *
 * Plugins call `ctx.discover.registerProvider(...)` (see PluginRouteContext);
 * the DiscoverService reads all registered providers plus its built-in ones.
 * Registration is imperative (not manifest-declared) because providers need
 * plugin-internal services (e.g. the news rssService) injected at construction.
 */

import type { DiscoverProvider } from "@pi-tree/plugin-sdk";

let _instance: DiscoverRegistry | null = null;

export class DiscoverRegistry {
  private providers = new Map<string, DiscoverProvider>();

  static getInstance(): DiscoverRegistry {
    if (!_instance) _instance = new DiscoverRegistry();
    return _instance;
  }

  register(provider: DiscoverProvider): void {
    if (this.providers.has(provider.sourceType)) {
      console.warn(`[discover] provider for "${provider.sourceType}" already registered — overwriting`);
    }
    this.providers.set(provider.sourceType, provider);
    console.log(`[discover] Registered provider: ${provider.sourceType}`);
  }

  all(): DiscoverProvider[] {
    return [...this.providers.values()];
  }
}
