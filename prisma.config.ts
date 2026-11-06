import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; load it first so the CLI sees the same values.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // react-server condition makes the "server-only" guard in lib/* a no-op.
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (session) connection — Supabase's transaction
    // pooler doesn't support the statements migrate uses. Runtime queries go
    // through DATABASE_URL in lib/db.ts.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
