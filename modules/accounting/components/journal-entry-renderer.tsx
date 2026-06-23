"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { TaskRendererProps } from "@/modules/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/formatters";
import {
  type JournalEntryPayload,
  type JournalLine,
  isPostable,
  journalTotals,
} from "@/modules/accounting/lib/journal-entry";

const emptyLine = (): JournalLine => ({
  accountCode: "",
  description: "",
  debit: 0,
  credit: 0,
});

function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Journal-entry task renderer. Editable balanced debit/credit lines while
 * draft/review; on approval the server posts them to the ledger (a side-effect
 * of the firm_approved transition) and they become read-only here. Reopening
 * reverses the post. The balance pill mirrors the server's balanced-batch
 * assertion — the post action is disabled until debits === credits.
 */
export function JournalEntryRenderer({ task, taskId }: TaskRendererProps) {
  const updateTask = useMutation(api.tasks.update);
  const setStatus = useMutation(api.tasks.setStatus);
  const accounts = useQuery(api.modules.accounting.accounts.listAccounts, {
    customerId: task.customerId,
  });

  const server = (task.payload ?? {}) as JournalEntryPayload;
  const posted = task.status === "firm_approved";
  const editable = task.status === "draft" || task.status === "review";

  const [date, setDate] = useState<number>(server.date ?? Date.now());
  const [memo, setMemo] = useState(server.memo ?? "");
  const [reference, setReference] = useState(server.reference ?? "");
  const [lines, setLines] = useState<JournalLine[]>(
    server.lines && server.lines.length >= 2
      ? server.lines
      : [emptyLine(), emptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const totals = journalTotals(lines);
  const payload: JournalEntryPayload = { date, memo, reference, lines };
  const canPost = isPostable(payload);

  async function persist(next?: Partial<JournalEntryPayload>) {
    await updateTask({
      taskId,
      payload: { date, memo, reference, lines, ...next },
    });
  }

  function setLine(i: number, patch: Partial<JournalLine>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  async function transition(
    status: "review" | "firm_approved" | "draft",
    reason?: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      // Flush the latest draft so the server posts what's on screen.
      if (editable) await persist();
      await setStatus({ taskId, status, ...(reason ? { reason } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const displayLines = posted ? server.lines ?? lines : lines;

  return (
    <article className="mx-auto w-full max-w-2xl px-8 py-10">
      <header className="space-y-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
          Journal entry
          <span className="mx-2 text-ink-4">·</span>
          <span className={posted ? "text-fmu-green" : "text-ink-2"}>
            {posted ? "Posted" : task.status === "review" ? "In review" : "Draft"}
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {task.title}
        </h1>
      </header>

      {/* Meta */}
      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
        <Field label="Date">
          {editable ? (
            <input
              type="date"
              value={toDateInput(date)}
              onChange={(e) =>
                setDate(new Date(e.target.value + "T12:00:00Z").getTime())
              }
              onBlur={() => void persist()}
              className="num rounded border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy"
            />
          ) : (
            <span className="num text-sm text-ink-2">{toDateInput(date)}</span>
          )}
        </Field>
        <Field label="Reference">
          {editable ? (
            <input
              type="text"
              value={reference}
              placeholder="optional"
              onChange={(e) => setReference(e.target.value)}
              onBlur={() => void persist()}
              className="w-40 rounded border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy"
            />
          ) : (
            <span className="text-sm text-ink-2">{reference || "—"}</span>
          )}
        </Field>
      </div>

      {/* Memo */}
      <div className="mt-4">
        {editable ? (
          <input
            type="text"
            value={memo}
            placeholder="Memo / narration"
            onChange={(e) => setMemo(e.target.value)}
            onBlur={() => void persist()}
            className="w-full rounded border border-line bg-card px-3 py-2 text-sm outline-none focus:border-fmu-navy"
          />
        ) : (
          memo && <p className="text-sm text-ink-2">{memo}</p>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-fmu-red/30 bg-fmu-red/5 px-3 py-2 text-[12px] text-fmu-red">
          {error}
        </div>
      )}

      {/* Lines */}
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-bg-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
              <th className="px-3 py-2.5">Account</th>
              <th className="px-3 py-2.5">Description</th>
              <th className="w-28 px-3 py-2.5 text-right">Debit</th>
              <th className="w-28 px-3 py-2.5 text-right">Credit</th>
              {editable && <th className="w-8 px-2 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {displayLines.map((l, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">
                  {editable ? (
                    <select
                      value={l.accountCode}
                      onChange={(e) =>
                        setLine(i, { accountCode: e.target.value })
                      }
                      onBlur={() => void persist()}
                      className="w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
                    >
                      <option value="">Select account…</option>
                      {(accounts ?? []).map((a) => (
                        <option key={a._id} value={a.code}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="num text-ink-2">{l.accountCode}</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {editable ? (
                    <input
                      type="text"
                      value={l.description ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        setLine(i, { description: e.target.value })
                      }
                      onBlur={() => void persist()}
                      className="w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
                    />
                  ) : (
                    <span className="text-ink-3">{l.description || "—"}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <AmountCell
                    value={l.debit}
                    editable={editable}
                    onChange={(n) =>
                      setLine(i, { debit: n, credit: n > 0 ? 0 : l.credit })
                    }
                    onBlur={() => void persist()}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <AmountCell
                    value={l.credit}
                    editable={editable}
                    onChange={(n) =>
                      setLine(i, { credit: n, debit: n > 0 ? 0 : l.debit })
                    }
                    onBlur={() => void persist()}
                  />
                </td>
                {editable && (
                  <td className="px-2 py-1.5">
                    {lines.length > 2 && (
                      <button
                        type="button"
                        aria-label="Remove line"
                        onClick={() => {
                          setLines((p) => p.filter((_, idx) => idx !== i));
                          void persist({
                            lines: lines.filter((_, idx) => idx !== i),
                          });
                        }}
                        className="text-ink-4 hover:text-fmu-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {editable && (
              <tr>
                <td colSpan={5} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setLines((p) => [...p, emptyLine()])}
                    className="flex items-center gap-1.5 text-xs text-ink-4 hover:text-ink-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add line
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-2 bg-card-tint/40 text-xs font-medium">
              <td className="px-3 py-2 text-ink-3" colSpan={2}>
                <span
                  className={cn(
                    "pill",
                    totals.balanced ? "pill--balanced" : "pill--blocked",
                  )}
                >
                  {totals.balanced ? "Balanced" : "Out of balance"}
                </span>
              </td>
              <td className="num px-3 py-2 text-right text-ink">
                {formatAmount(totals.debit)}
              </td>
              <td className="num px-3 py-2 text-right text-ink">
                {formatAmount(totals.credit)}
              </td>
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {accounts !== undefined && accounts.length === 0 && (
        <p className="mt-3 text-[12px] text-ink-3">
          No accounts yet — set up the{" "}
          <Link
            href={`/customers/${task.customerId}/accounting/accounts`}
            className="text-fmu-navy underline"
          >
            chart of accounts
          </Link>{" "}
          first.
        </p>
      )}

      {/* Actions */}
      <section className="mt-8 border-t border-line pt-6">
        {posted ? (
          <div className="space-y-3">
            <p className="text-[12px] text-fmu-green">
              Posted to the ledger.{" "}
              <Link
                href={`/customers/${task.customerId}/accounting/ledger`}
                className="underline"
              >
                View in ledger →
              </Link>
            </p>
            {reopening ? (
              <div className="space-y-2 rounded-lg border border-line bg-card-tint/40 p-3">
                <label className="block text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Reason for reopening (reverses the posted ledger batch)
                </label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="e.g. wrong account, period correction"
                  className="w-full rounded border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-fmu-navy"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !reopenReason.trim()}
                    onClick={() => void transition("review", reopenReason)}
                  >
                    Confirm reopen
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReopening(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setReopening(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reopen
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {task.status === "draft" && (
              <Button
                size="lg"
                variant="outline"
                disabled={busy}
                onClick={() => void transition("review")}
              >
                Send for review
              </Button>
            )}
            <Button
              size="lg"
              disabled={busy || !canPost}
              onClick={() => void transition("firm_approved")}
            >
              Approve &amp; post
            </Button>
            {task.status === "review" && (
              <Button
                size="lg"
                variant="outline"
                disabled={busy}
                onClick={() => void transition("draft")}
              >
                Back to draft
              </Button>
            )}
            {!canPost && (
              <span className="ml-auto text-[11px] text-ink-3">
                Balance debits and credits to post
              </span>
            )}
          </div>
        )}
      </section>
    </article>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      {children}
    </div>
  );
}

function AmountCell({
  value,
  editable,
  onChange,
  onBlur,
}: {
  value: number;
  editable: boolean;
  onChange: (n: number) => void;
  onBlur: () => void;
}) {
  if (!editable) {
    return (
      <span className="num text-ink-2">
        {value > 0 ? formatAmount(value) : ""}
      </span>
    );
  }
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={value || ""}
      onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
      onBlur={onBlur}
      className="num w-full rounded border border-line bg-card px-2 py-1 text-right text-xs outline-none focus:border-fmu-navy"
    />
  );
}
