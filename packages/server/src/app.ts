import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "./db/index.js";
import { libraryRoutes } from "./routes/library.js";
import { sessionRoutes } from "./routes/session.js";
import { userRoutes } from "./routes/users.js";
import { dictionaryRoutes } from "./routes/dictionary.js";
import { getServerConfig, saveServerConfig } from "./config.js";

export const app = new Hono();

// Initialize database on startup
getDb();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (e.g. curl, server-to-server)
      if (!origin) return "http://localhost:5847";
      // In development, accept any origin (LAN devices, localhost variants)
      return origin;
    },
  }),
);

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// API routes
app.route("/api/library", libraryRoutes);
app.route("/api/session", sessionRoutes);
app.route("/api/users", userRoutes);
app.route("/api/dict", dictionaryRoutes);

// Server config endpoints
app.get("/api/config", (c) => {
  const cfg = getServerConfig();
  return c.json({
    readingModel: cfg.readingModel,
    lookupModel: cfg.lookupModel,
    provider: cfg.provider ?? "",
    apiKey: cfg.apiKey ? "••••••••" : "",
    baseUrl: cfg.baseUrl ?? "",
  });
});

app.put("/api/config", async (c) => {
  try {
    const body = await c.req.json();
    const updated = saveServerConfig(body);
    return c.json({
      success: true,
      config: {
        readingModel: updated.readingModel,
        lookupModel: updated.lookupModel,
        provider: updated.provider ?? "",
        apiKey: updated.apiKey ? "••••••••" : "",
        baseUrl: updated.baseUrl ?? "",
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ---------------------------------------------------------------------------
// Production: serve client static files (Docker / NODE_ENV=production)
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV === "production") {
  const { serveStatic } = await import("@hono/node-server/serve-static");
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  // Serve static assets (JS, CSS, images, etc.)
  app.use(
    "/*",
    serveStatic({
      root: "packages/client/dist",
      // Don't intercept API routes — they're already handled above
      onNotFound: (_path, c) => {
        // Let it fall through to the SPA fallback below
      },
    }),
  );

  // SPA fallback: serve index.html for any non-API, non-file route
  // (supports client-side routing like /book/:id)
  app.get("*", async (c) => {
    const indexPath = join(process.cwd(), "packages/client/dist/index.html");
    try {
      const html = await readFile(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("Frontend not built. Run: npm run build", 500);
    }
  });
}
