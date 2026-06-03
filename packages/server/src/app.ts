import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { libraryRoutes } from "./routes/library.js";
import { sessionRoutes } from "./routes/session.js";

export const app = new Hono();

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
