import "server-only";
import { getDb } from "./db";

export const unreadCount = (userId: string) =>
  getDb().notification.count({ where: { userId, read: false } });

/** Latest notifications, newest first; marks the returned ones read. */
export async function readNotifications(userId: string, take = 50) {
  const db = getDb();
  const items = await db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
  const unread = items.filter((n) => !n.read).map((n) => n.id);
  if (unread.length > 0) await db.notification.updateMany({ where: { id: { in: unread } }, data: { read: true } });
  return items;
}
