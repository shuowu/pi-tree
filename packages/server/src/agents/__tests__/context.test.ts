import { describe, it, expect, beforeEach } from "vitest";
import { getExtensionServices, setExtensionServices } from "../context.js";

describe("Extension Services (context)", () => {
  beforeEach(() => {
    // Clear the global state before each test
    delete (globalThis as any).__piTreeExtensionServices;
  });

  it("throws error when getExtensionServices is called before initialization", () => {
    expect(() => getExtensionServices()).toThrowError(
      "Extension services not initialized — server must call setExtensionServices() at startup"
    );
  });

  it("successfully sets and gets services", () => {
    const dummyServices = {
      db: () => "mock-db",
      schema: {
        sources: {},
        userSessions: {},
        users: {},
      },
      rssService: {},
    };

    setExtensionServices(dummyServices);

    const retrieved = getExtensionServices();
    expect(retrieved).toBe(dummyServices);
    expect(retrieved.db()).toBe("mock-db");
  });

  it("persists services via globalThis to ensure Jiti/loader compatibility", () => {
    const dummyServices = {
      db: () => "global-db",
      schema: {
        sources: {},
        userSessions: {},
        users: {},
      },
      rssService: {},
    };

    setExtensionServices(dummyServices);

    expect((globalThis as any).__piTreeExtensionServices).toBe(dummyServices);
  });
});
