import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // The "session" table is owned by connect-pg-simple (session store), not
  // Drizzle. Exclude it so `drizzle-kit push` never tries to drop it.
  tablesFilter: ["*", "!session"],
});
