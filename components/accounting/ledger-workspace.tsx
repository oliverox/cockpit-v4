"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/states";
import { IncomeExpenseChart } from "@/components/accounting/income-expense-chart";
import { TrialBalanceTable } from "@/components/accounting/trial-balance-table";
import { TransactionsTable } from "@/components/accounting/transactions-table";

type View = "pnl" | "trial" | "transactions";

const VIEWS: { id: View; label: string }[] = [
  { id: "pnl", label: "Income vs expense" },
  { id: "trial", label: "Trial balance" },
  { id: "transactions", label: "Transactions" },
];

export function LedgerWorkspace({
  customerId,
}: {
  customerId: Id<"customers">;
}) {
  const [view, setView] = useState<View>("pnl");
  const [months, setMonths] = useState(12);
  const router = useRouter();
  const createTask = useMutation(api.tasks.create);
  const [creating, setCreating] = useState(false);

  async function createAndOpen(type: string, title: string) {
    setCreating(true);
    try {
      const taskId = await createTask({
        customerId,
        moduleId: "accounting",
        type,
        title,
      });
      router.push(`/customers/${customerId}/tasks/${taskId}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-card p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                view === v.id
                  ? "bg-fmu-navy text-white"
                  : "text-ink-3 hover:bg-card-tint hover:text-ink",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void createAndOpen("accounting.bank_rec", "Bank statement import")
            }
            disabled={creating}
          >
            <Upload className="h-3.5 w-3.5" />
            Import bank statement
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void createAndOpen("accounting.journal_entry", "Journal entry")
            }
            disabled={creating}
          >
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            New journal entry
          </Button>
        </div>
      </div>

      {view === "pnl" && (
        <PnlView customerId={customerId} months={months} onMonths={setMonths} />
      )}
      {view === "trial" && <TrialBalanceTable customerId={customerId} />}
      {view === "transactions" && (
        <TransactionsTable customerId={customerId} />
      )}
    </div>
  );
}

function PnlView({
  customerId,
  months,
  onMonths,
}: {
  customerId: Id<"customers">;
  months: number;
  onMonths: (m: number) => void;
}) {
  const data = useQuery(api.modules.accounting.ledger.getIncomeExpenseSeries, {
    customerId,
    months,
  });

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Income vs expense</div>
          <div className="text-xs text-ink-3">
            Posted revenue and expense by month (MUR)
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-line p-0.5">
          {[6, 12, 24].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMonths(m)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                months === m
                  ? "bg-fmu-navy text-white"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
      {data === undefined ? <LoadingState /> : <IncomeExpenseChart data={data} />}
    </div>
  );
}
