import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireEnv } from "./env";

/**
 * Single PrismaClient per process. In dev, Next.js hot reload re-evaluates
 * modules, so the instance is parked on globalThis to avoid leaking pools.
 *
 * DATABASE_URL should be Supabase's pooled connection string. The pool is
 * kept small because Vercel Hobby functions are short-lived.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: requireEnv("DATABASE_URL"),
    max: 3,
  });
  return new PrismaClient({ adapter });
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/** True when a database is configured — lets callers degrade gracefully. */
export const hasDatabase = (): boolean => Boolean(process.env.DATABASE_URL);
