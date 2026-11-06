import type { WatchStatus } from "@/generated/prisma/enums";

const STYLES: Record<WatchStatus, { label: string; bg: string }> = {
  ACTIVE: { label: "Watching", bg: "bg-yellow" },
  AWAITING_APPROVAL: { label: "Awaiting approval", bg: "bg-pink" },
  PURCHASING: { label: "Purchasing", bg: "bg-blue" },
  BOUGHT: { label: "Bought", bg: "bg-green" },
  REFUNDED: { label: "Refunded", bg: "bg-card" },
  PAUSED: { label: "Paused", bg: "bg-grey" },
  EXPIRED: { label: "Expired", bg: "bg-grey" },
  CANCELLED: { label: "Cancelled", bg: "bg-red" },
};

/** Uppercase mono label on the status colour. */
export function StatusChip({ status }: { status: WatchStatus }) {
  const s = STYLES[status];
  return <span className={`nb-chip ${s.bg}`}>{s.label}</span>;
}
