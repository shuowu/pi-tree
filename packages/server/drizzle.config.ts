import { defineConfig } from "drizzle-kit";
import path from "node:path";

const dataPath =
  process.env.DATA_PATH ??
  path.join(process.env.HOME ?? "~", ".local", "share", "pi-tree");

const dbPath = path.join(dataPath, "pi-tree.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
