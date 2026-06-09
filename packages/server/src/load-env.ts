import { config as loadEnv } from "dotenv";
import os from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

// dotenv only sets vars that are NOT already in the environment.
// In dev, direnv pre-loads .envrc (which sources .env + applies dev overrides),
// so dotenv is effectively a no-op. In Docker, env_file loads .env directly.
loadEnv({ path: resolve(root, ".env") });

// Last-resort defaults — safety net when neither direnv nor .env provides them
process.env.PORT ??= "3847";
process.env.DATA_PATH ??= join(os.homedir(), ".local", "share", "pi-tree");

