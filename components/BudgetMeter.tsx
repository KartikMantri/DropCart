import type { BudgetSummary } from "@/lib/budget";
import { formatUsd } from "@/lib/mandate";
import { TopUpForm } from "./TopUpForm";

/**
 * DropCart Budget meter: a running pot. Spent and reserved fill the bar;
 * the rest is free for new watches. No money is held by DropCart.
 */
export function BudgetMeter({ summary }: { summary: BudgetSummary }) {
  const { budget, spent, reserved, available } = summary;
  const pct = (n: number) => (budget > 0 ? Math.min(100, Math.max(0, (n / budget) * 100)) : 0);

  return (
    <section id="budget" className="nb-card mb-6 flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold uppercase">DropCart Budget</h3>
          <p className="text-sm">
            Each watch reserves its max price. PayPal is charged only when something is bought.
          </p>
        </div>
        <p className="font-mono">
          <span className="text-3xl font-extrabold">{formatUsd(Math.max(0, available))}</span> free of{" "}
          {formatUsd(budget)}
        </p>
      </div>

      <div
        className="flex h-6 w-full overflow-hidden border-[3px] border-ink bg-card"
        role="img"
        aria-label={`${formatUsd(spent)} spent, ${formatUsd(reserved)} reserved, ${formatUsd(available)} free`}
      >
        <div className="h-full bg-ink" style={{ width: `${pct(spent)}%` }} />
        <div className="h-full bg-yellow" style={{ width: `${pct(reserved)}%` }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-sm">
          <li>
            <span className="mr-1 inline-block h-3 w-3 border-2 border-ink bg-ink align-middle" /> Spent{" "}
            <b>{formatUsd(spent)}</b>
          </li>
          <li>
            <span className="mr-1 inline-block h-3 w-3 border-2 border-ink bg-yellow align-middle" /> Reserved{" "}
            <b>{formatUsd(reserved)}</b>
          </li>
          <li>
            <span className="mr-1 inline-block h-3 w-3 border-2 border-ink bg-card align-middle" /> Free{" "}
            <b>{formatUsd(Math.max(0, available))}</b>
          </li>
        </ul>
        <TopUpForm current={budget} floor={spent + reserved} />
      </div>
    </section>
  );
}
