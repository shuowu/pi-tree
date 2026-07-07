/**
 * RouterDestinationRegistry — navigable destinations the home-page router can
 * send users to (feature pages like Discover), as opposed to sources/sessions.
 *
 * Built-in features register at bootstrap; plugins register via
 * `PluginRouteContext.router.registerDestination`. The router agent exposes a
 * single generic `navigate_to` tool whose choices come from this registry, so
 * adding a new routable page is one register() call — no router code changes.
 */

import type { RouterDestination } from "@pi-tree/plugin-sdk";

let _instance: RouterDestinationRegistry | null = null;

export class RouterDestinationRegistry {
  private destinations = new Map<string, RouterDestination>();

  static getInstance(): RouterDestinationRegistry {
    if (!_instance) _instance = new RouterDestinationRegistry();
    return _instance;
  }

  register(destination: RouterDestination): void {
    this.destinations.set(destination.id, destination);
    console.log(`[router] Registered destination: ${destination.id}`);
  }

  all(): RouterDestination[] {
    return [...this.destinations.values()];
  }

  get(id: string): RouterDestination | undefined {
    return this.destinations.get(id);
  }
}
