import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

// Load .env
loadEnv({ path: resolve(root, ".env") });

// Dev defaults — separate port/DB so dev never collides with Docker
if (process.env.NODE_ENV !== "production") {
  process.env.PORT ??= "3947";
  process.env.DATA_PATH ??= "~/.local/share/pi-books-dev";
}
