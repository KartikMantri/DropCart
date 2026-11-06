/**
 * Print each user's DropCart Budget (read-only).
 *   npx tsx --conditions=react-server scripts/budget-report.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const { getDb } = await import("../lib/db");
  const { getBudget } = await import("../lib/budget");
  const users = await getDb().user.findMany({ select: { id: true, email: true } });
  for (const u of users) console.log(u.email.replace(/^(.).*@/, "$1***@"), await getBudget(u.id));
  await getDb().$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
