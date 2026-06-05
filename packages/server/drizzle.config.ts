import { defineConfig } from "drizzle-kit";
import path from "node:path";

const dataPath =
  process.env.DATA_PATH ??
  path.join(process.env.HOME ?? "~", ".local", "share", "pi-reader");

const dbPath = path.join(dataPath, "pi-reader.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
