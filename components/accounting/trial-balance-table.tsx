"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LoadingState } from "@/components/states";
import { formatAmount } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/** Trial balance as of now — accounts with a balance, debit/credit columns,
 *  and a balanced check. Opening balances are folded in server-side. */
export function TrialBalanceTable({
  customerId,
}: {
  customerId: Id<"customers">;
}) {
  const tb = useQuery(api.modules.accounting.ledger.getTrialBalance, {
    customerId,
  });
  if (tb === undefined) return <LoadingState />;

  const rows = tb.rows.filter((r) => r.debit !== 0 || r.credit !== 0);
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-10 text-center text-sm text-ink-3">
        No account balances yet. Post a journal entry to populate the ledger.
      </div>
    );
  }
  const balanced = Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line bg-bg-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
            <th className="w-24 px-4 py-2.5">Code</th>
            <th className="px-4 py-2.5">Name</th>
            <th className="w-24 px-4 py-2.5">Type</th>
            <th className="w-32 px-4 py-2.5 text-right">Debit</th>
            <th className="w-32 px-4 py-2.5 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-line last:border-0">
              <td className="num px-4 py-1.5 text-ink-2">{r.code}</td>
              <td className="px-4 py-1.5 text-ink">{r.name}</td>
              <td className="px-4 py-1.5 text-ink-3">{r.type}</td>
              <td className="num px-4 py-1.5 text-right">
                {r.debit ? formatAmount(r.debit) : ""}
              </td>
              <td className="num px-4 py-1.5 text-right">
                {r.credit ? formatAmount(r.credit) : ""}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-2 bg-card-tint/40 text-xs font-medium">
            <td className="px-4 py-2" colSpan={3}>
              <span
                className={cn(
                  "pill",
                  balanced ? "pill--balanced" : "pill--blocked",
                )}
              >
                {balanced ? "Balanced" : "Out of balance"}
              </span>
            </td>
            <td className="num px-4 py-2 text-right text-ink">
              {formatAmount(tb.totalDebit)}
            </td>
            <td className="num px-4 py-2 text-right text-ink">
              {formatAmount(tb.totalCredit)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
