// Load .env from repo root before anything reads process.env
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(import.meta.dirname, "../../../.env") });

import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3847);

console.log(`🚀 pi-reader server starting on http://localhost:${port}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ Server listening on http://localhost:${info.port}`);
});
