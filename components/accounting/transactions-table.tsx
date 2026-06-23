"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LoadingState } from "@/components/states";
import { formatAmount, formatDate } from "@/lib/formatters";

function sourceLabel(s: string): string {
  switch (s) {
    case "journal_entry":
      return "Journal";
    case "bank_statement":
      return "Bank";
    case "opening_balance":
      return "Opening";
    default:
      return "System";
  }
}

/** Ledger transactions, most recent first. Posted entries link back to the
 *  journal-entry task that created them. */
export function TransactionsTable({
  customerId,
}: {
  customerId: Id<"customers">;
}) {
  const txns = useQuery(api.modules.accounting.ledger.listTransactions, {
    customerId,
  });
  if (txns === undefined) return <LoadingState />;
  if (txns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-10 text-center text-sm text-ink-3">
        No ledger transactions yet. Approve a journal entry to post one.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line bg-bg-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
            <th className="w-28 px-4 py-2.5">Date</th>
            <th className="px-4 py-2.5">Account</th>
            <th className="px-4 py-2.5">Description</th>
            <th className="w-28 px-4 py-2.5 text-right">Debit</th>
            <th className="w-28 px-4 py-2.5 text-right">Credit</th>
            <th className="w-20 px-4 py-2.5">Source</th>
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr
              key={t._id}
              className="border-b border-line last:border-0 hover:bg-card-tint/40"
            >
              <td className="num px-4 py-1.5 text-ink-3">{formatDate(t.date)}</td>
              <td className="px-4 py-1.5">
                <span className="num text-ink-2">{t.accountCode}</span>{" "}
                <span className="text-ink-3">{t.accountName}</span>
              </td>
              <td className="px-4 py-1.5 text-ink">{t.description}</td>
              <td className="num px-4 py-1.5 text-right">
                {t.debit ? formatAmount(t.debit) : ""}
              </td>
              <td className="num px-4 py-1.5 text-right">
                {t.credit ? formatAmount(t.credit) : ""}
              </td>
              <td className="px-4 py-1.5">
                {t.postedByTaskId ? (
                  <Link
                    href={`/customers/${customerId}/tasks/${t.postedByTaskId}`}
                    className="text-fmu-navy hover:underline"
                  >
                    {sourceLabel(t.sourceType)}
                  </Link>
                ) : (
                  <span className="text-ink-3">{sourceLabel(t.sourceType)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
