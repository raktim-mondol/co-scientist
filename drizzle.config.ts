import type { Config } from "drizzle-kit";
import { homedir } from "os";
import { join } from "path";
import "dotenv/config";

const dbPath =
  process.env.DB_PATH ?? join(homedir(), ".co-scientist", "co-scientist.db");

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  driver: "bun-sqlite",
  dbCredentials: {
    url: dbPath,
  },
} satisfies Config;
