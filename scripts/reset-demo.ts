/**
 * Reset the DEMO account to a clean state for judges (only the demo user).
 *
 *   npx tsx --conditions=react-server scripts/reset-demo.ts          dry run: shows what would go
 *   npx tsx --conditions=react-server scripts/reset-demo.ts --yes    do it, then run `npx prisma db seed`
 *
 * Deletes the demo user's price trackers (with their price checks, purchases
 * and audit log) and notifications, and sets the budget back to $500.
 * Keeps the wishlist and the saved PayPal sandbox token (pass --disconnect-paypal
 * to clear it too). Sandbox records at PayPal are not touched.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const yes = process.argv.includes("--yes");
  const disconnect = process.argv.includes("--disconnect-paypal");
  const { getDb } = await import("../lib/db");
  const { DEMO_EMAIL } = await import("../lib/demo-account");
  const db = getDb();

  const user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) throw new Error(`No user ${DEMO_EMAIL}. Run \`npx prisma db seed\` first.`);

  const [trackers, purchases, notifications, likes] = await Promise.all([
    db.watch.count({ where: { userId: user.id } }),
    db.purchase.count({ where: { watch: { userId: user.id } } }),
    db.notification.count({ where: { userId: user.id } }),
    db.likedItem.count({ where: { userId: user.id } }),
  ]);
  console.log(`Demo account ${DEMO_EMAIL}:`);
  console.log(`  delete ${trackers} price trackers (incl. ${purchases} purchases, their price checks and audit log)`);
  console.log(`  delete ${notifications} notifications`);
  console.log(`  budget $${user.budget} → $500`);
  console.log(`  keep ${likes} wishlist items`);
  console.log(`  PayPal sandbox token: ${disconnect ? "clear" : user.paypalVaultToken ? "keep (connected)" : "not connected"}`);

  if (!yes) {
    console.log("\nDry run. Re-run with --yes to apply.");
  } else {
    await db.$transaction([
      db.watch.deleteMany({ where: { userId: user.id } }),
      db.notification.deleteMany({ where: { userId: user.id } }),
      db.user.update({
        where: { id: user.id },
        data: { budget: 500, ...(disconnect ? { paypalVaultToken: null, paypalCustomerId: null } : {}) },
      }),
    ]);
    console.log("\nDone. Now run `npx prisma db seed` to add the starter tracker.");
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
