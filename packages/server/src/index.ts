import "./load-env.js";
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3847);
const hostname = process.env.HOST ?? "0.0.0.0";

console.log(`🚀 pi-tree server starting on http://${hostname}:${port}`);

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`✅ Server listening on http://${hostname}:${info.port}`);
});
