import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

// Load base .env first
loadEnv({ path: resolve(root, ".env") });

// In non-production, overlay .env.dev (overrides PORT, DATA_PATH, etc.)
if (process.env.NODE_ENV !== "production") {
  loadEnv({ path: resolve(root, ".env.dev"), override: true });
}
