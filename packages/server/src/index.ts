import "./load-env.js";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import os from "node:os";
import { bootstrap } from "./bootstrap.js";

const port = Number(process.env.PORT ?? 3847);
const hostname = process.env.HOST ?? "0.0.0.0";
const dataPath = process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");

const { app } = await bootstrap({
  dataPath,
  coreDir: import.meta.dirname,
});

console.log(`🚀 pi-tree server starting on http://${hostname}:${port}`);

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`✅ Server listening on http://${hostname}:${info.port}`);
});
