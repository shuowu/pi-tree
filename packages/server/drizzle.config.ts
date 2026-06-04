import { defineConfig } from "drizzle-kit";
import path from "node:path";

const libraryPath =
  process.env.LIBRARY_PATH ??
  path.join(process.env.HOME ?? "~", "repos", "pi-books", "library");

const dbPath = path.join(libraryPath, "..", ".pi-reader", "pi-reader.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
