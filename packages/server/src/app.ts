import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { libraryRoutes } from "./routes/library.js";
import { sessionRoutes } from "./routes/session.js";
import { sessionCrudRoutes } from "./routes/sessions.js";
import { userRoutes } from "./routes/users.js";
import { dictionaryRoutes } from "./routes/dictionary.js";
import { routerRoutes } from "./routes/router.js";
import { modelRoutes } from "./routes/models.js";
import { configRoutes } from "./routes/config.js";

import { getAgentRegistry } from "./services/agent-registry.js";
import { VERSION } from "./version.js";

export const app = new Hono();



// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (e.g. curl, server-to-server)
      if (!origin) return "http://localhost:5947";
      // In development, accept any origin (LAN devices, localhost variants)
      return origin;
    },
  }),
);

// ---------------------------------------------------------------------------
// Global error handling
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const message = err instanceof Error ? err.message : "Internal server error";

  if (status >= 500) {
    console.error(`[${c.req.method}] ${c.req.path} → ${status}:`, err);
  } else {
    console.warn(`[${c.req.method}] ${c.req.path} → ${status}: ${message}`);
  }

  return c.json({ error: message, status }, status as any);
});

app.notFound((c) => {
  return c.json({ error: "Not found", status: 404 }, 404);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: VERSION }));

// API routes
app.route("/api/library", libraryRoutes);
app.route("/api/session", sessionRoutes);
app.route("/api/sessions", sessionCrudRoutes);
app.route("/api/users", userRoutes);
app.route("/api/dict", dictionaryRoutes);
app.route("/api/router", routerRoutes);
app.route("/api/models", modelRoutes);
app.route("/api/config", configRoutes);

// Profiles introspection — list all available session profiles
app.get("/api/profiles", (c) => {
  const registry = getAgentRegistry();
  const profiles = registry.getProfiles();
  const result: Record<string, object> = {};
  for (const [key, profile] of profiles) {
    // Skip internal profiles — not user-facing session modes
    if (key === "_default" || key === "router" || profile.hidden) continue;
    result[key] = {
      label: profile.label,
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.sourceType ? { sourceType: profile.sourceType } : {}),
      skills: profile.skills,
      extensions: profile.extensions,
      excludeTools: profile.excludeTools,
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.icon ? { icon: profile.icon } : {}),
      ...(profile.defaultPrompt ? { defaultPrompt: profile.defaultPrompt } : {}),
      ...(profile.quickActions ? { quickActions: profile.quickActions } : {}),
      order: profile.order,
    };
  }
  return c.json(result);
});

// Test-only routes — seed data for e2e tests (only when PI_MOCK=true)
if (process.env.PI_MOCK === "true") {
  const { testRoutes } = await import("./routes/test.js");
  app.route("/api/test", testRoutes);
}


// ---------------------------------------------------------------------------
// Production: serve client static files (Docker / Electron / NODE_ENV=production)
// ---------------------------------------------------------------------------

/**
 * Mount the SPA static file server and catch-all fallback.
 * MUST be called AFTER all API and plugin routes are registered,
 * because Hono matches routes in registration order — a wildcard
 * registered too early would swallow plugin API routes.
 */
export async function mountSpaFallback() {
  if (process.env.NODE_ENV !== "production") return;

  const { serveStatic } = await import("@hono/node-server/serve-static");
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  // CLIENT_DIST_PATH: absolute path to the client build output.
  //   Docker/CLI: defaults to packages/client/dist (relative to cwd)
  //   Electron:   set to process.resourcesPath + "/client" by main.ts
  const clientDistPath = process.env.CLIENT_DIST_PATH
    ?? join(process.cwd(), "packages/client/dist");

  // Serve static assets (JS, CSS, images, etc.)
  app.use(
    "/*",
    serveStatic({
      root: clientDistPath,
      rewriteRequestPath: (path) => path, // serve from absolute path
      // Don't intercept API routes — they're already handled above
      onNotFound: (_path, c) => {
        // Let it fall through to the SPA fallback below
      },
    }),
  );

  // SPA fallback: serve index.html for any non-API, non-file route
  // (supports client-side routing like /book/:id)
  app.get("*", async (c) => {
    const indexPath = join(clientDistPath, "index.html");
    try {
      const html = await readFile(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("Frontend not built. Run: npm run build", 500);
    }
  });
}
