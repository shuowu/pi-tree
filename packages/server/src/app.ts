import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "./db/index.js";
import { libraryRoutes } from "./routes/library.js";
import { sessionRoutes } from "./routes/session.js";
import { userRoutes } from "./routes/users.js";

export const app = new Hono();

// Initialize database on startup
getDb();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173"], // Vite dev server
  }),
);

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// API routes
app.route("/api/library", libraryRoutes);
app.route("/api/session", sessionRoutes);
app.route("/api/users", userRoutes);

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
