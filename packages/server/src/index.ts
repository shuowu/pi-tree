import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3001);

console.log(`🚀 pi-reader server starting on http://localhost:${port}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ Server listening on http://localhost:${info.port}`);
});
