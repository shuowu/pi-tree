import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    // Only used by db:push / db:studio (not by migrate())
    url: ":memory:",
  },
});
