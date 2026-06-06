import { defineConfig } from "drizzle-kit";
import path from "node:path";

const dataPath =
  process.env.DATA_PATH ??
  path.join(process.env.HOME ?? "~", ".local", "share", "pi-books");

const dbPath = path.join(dataPath, "pi-books.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
