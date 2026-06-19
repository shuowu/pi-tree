import { describe, it, expect, beforeEach } from "vitest";
import { getExtensionServices, setExtensionServices } from "../context.js";

describe("Extension Services (context)", () => {
  beforeEach(() => {
    // Clear the global state before each test
    delete (globalThis as any).__piTreeServices;
  });

  it("throws error when getExtensionServices is called before initialization", () => {
    expect(() => getExtensionServices()).toThrowError(
      "Extension services not initialized — server must call setExtensionServices() at startup"
    );
  });

  it("successfully sets and gets services", () => {
    const dummyServices = {
      sources: { list: () => [], get: () => null },
      sessions: { listForSource: () => [], create: () => ({}), resolveUserId: () => undefined, getById: () => null },
      users: { get: () => null, ensureExists: () => ({}) },
      registry: { getProfiles: () => new Map() },
      config: {},
      getPluginDataDir: () => "/tmp/test/plugins",
      dataPath: "/tmp/test",
      db: () => "mock-db",
      schema: {
        sources: {},
        userSessions: {},
        users: {},
      },
    };

    setExtensionServices(dummyServices as any);

    const retrieved = getExtensionServices();
    expect(retrieved).toBe(dummyServices);
    expect(retrieved.db()).toBe("mock-db");
  });

  it("persists services via globalThis to ensure Jiti/loader compatibility", () => {
    const dummyServices = {
      sources: { list: () => [], get: () => null },
      sessions: { listForSource: () => [], create: () => ({}), resolveUserId: () => undefined, getById: () => null },
      users: { get: () => null, ensureExists: () => ({}) },
      registry: { getProfiles: () => new Map() },
      config: {},
      getPluginDataDir: () => "/tmp/test/plugins",
      dataPath: "/tmp/test",
      db: () => "global-db",
      schema: {
        sources: {},
        userSessions: {},
        users: {},
      },
    };

    setExtensionServices(dummyServices as any);

    expect((globalThis as any).__piTreeServices).toBe(dummyServices);
  });
});
