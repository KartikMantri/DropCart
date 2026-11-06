import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
import { BudgetError, getBudget, setBudget } from "@/lib/budget";

/** DropCart Budget: budget, spent, reserved, available. */
export async function GET() {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await getBudget(user.id));
}

const bodySchema = z.object({ budget: z.number().finite() });

/** Top up (or lower) the budget. No money moves; it only changes the cap. */
export async function POST(req: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a budget in dollars." }, { status: 400 });

  try {
    return NextResponse.json(await setBudget(user.id, parsed.data.budget));
  } catch (err) {
    if (err instanceof BudgetError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
