"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Loader2, RotateCcw, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { TaskRendererProps } from "@/modules/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount, formatDate } from "@/lib/formatters";
import {
  type BankRecPayload,
  type ColumnMap,
  type StatementLine,
  bankRecCoverage,
  guessColumnMap,
  hashText,
  mapRowsToLines,
  parseStatementCsv,
} from "@/modules/accounting/lib/bank-statement";

type Parsed = { headers: string[]; rows: Record<string, string>[] };

export function BankRecRenderer({ task, taskId }: TaskRendererProps) {
  const updateTask = useMutation(api.tasks.update);
  const setStatus = useMutation(api.tasks.setStatus);
  const accounts = useQuery(api.modules.accounting.accounts.listAccounts, {
    customerId: task.customerId,
  });
  const bankAccounts = useQuery(
    api.modules.accounting.bankAccounts.listBankAccounts,
    { customerId: task.customerId },
  );
  const createBankAccount = useMutation(
    api.modules.accounting.bankAccounts.createBankAccount,
  );

  const server = (task.payload ?? {}) as BankRecPayload;
  const posted = task.status === "firm_approved";
  const editable = task.status === "draft" || task.status === "review";

  const [bankAccountId, setBankAccountId] = useState(server.bankAccountId ?? "");
  const [lines, setLines] = useState<StatementLine[]>(server.lines ?? []);
  const [hash, setHash] = useState(server.statementFileHash ?? "");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [newBank, setNewBank] = useState<{ name: string; code: string } | null>(
    null,
  );

  const coverage = bankRecCoverage(lines);
  const ready =
    coverage.ready && !!bankAccountId && (accounts?.length ?? 0) > 0;
  const postedBankName = (bankAccounts ?? []).find(
    (b) => b._id === (server.bankAccountId ?? bankAccountId),
  )?.name;

  async function persist(next?: Partial<BankRecPayload>) {
    // Merge overrides first, then derive the period from the *merged* lines —
    // so a passed-in `lines` always wins over the render-scope closure.
    const merged: BankRecPayload = {
      bankAccountId,
      statementFileHash: hash,
      lines,
      ...next,
    };
    const dates = merged.lines.map((l) => l.date);
    merged.periodStart = dates.length ? Math.min(...dates) : undefined;
    merged.periodEnd = dates.length ? Math.max(...dates) : undefined;
    await updateTask({ taskId, payload: merged });
  }

  async function onFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const res = parseStatementCsv(text);
      setParsed(res);
      setColumnMap(guessColumnMap(res.headers));
      setHash(hashText(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function importParsed() {
    if (!parsed || !columnMap) return;
    const { lines: mapped, skipped } = mapRowsToLines(parsed.rows, columnMap);
    if (mapped.length === 0) {
      setError("No usable transactions — check the column mapping.");
      return;
    }
    setError(null);
    setLines(mapped);
    setParsed(null);
    setColumnMap(null);
    if (skipped.length > 0) {
      const counts = skipped.reduce<Record<string, number>>((a, s) => {
        a[s.reason] = (a[s.reason] ?? 0) + 1;
        return a;
      }, {});
      const summary = Object.entries(counts)
        .map(([r, n]) => `${n} ${r}`)
        .join(", ");
      setNotice(
        `Imported ${mapped.length} of ${mapped.length + skipped.length} rows — ${skipped.length} skipped (${summary}).`,
      );
    } else {
      setNotice(null);
    }
    void persist({ lines: mapped });
  }

  function setLineAccount(rowHash: string, accountCode: string) {
    setLines((prev) => {
      const next = prev.map((l) =>
        l.rowHash === rowHash ? { ...l, accountCode } : l,
      );
      void persist({ lines: next });
      return next;
    });
  }

  async function chooseBank(id: string) {
    setBankAccountId(id);
    await persist({ bankAccountId: id });
  }

  async function addBankAccount() {
    if (!newBank?.name.trim() || !newBank.code) return;
    setError(null);
    setBusy(true);
    try {
      const id = await createBankAccount({
        customerId: task.customerId,
        name: newBank.name.trim(),
        ledgerAccountCode: newBank.code,
      });
      setNewBank(null);
      await chooseBank(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    status: "review" | "firm_approved" | "draft",
    reason?: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      if (editable) await persist();
      await setStatus({ taskId, status, ...(reason ? { reason } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <header className="space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
          Bank reconciliation
          <span className="mx-2 text-ink-4">·</span>
          <span className={posted ? "text-fmu-green" : "text-ink-2"}>
            {posted
              ? "Posted"
              : task.status === "review"
                ? "In review"
                : "Draft"}
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {task.title}
        </h1>
      </header>

      {error && (
        <div className="mt-4 rounded-md border border-fmu-red/30 bg-fmu-red/5 px-3 py-2 text-[12px] text-fmu-red">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-md border border-fmu-yellow/40 bg-fmu-yellow/5 px-3 py-2 text-[12px] text-ink-2">
          {notice}
        </div>
      )}

      {accounts !== undefined && accounts.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-center text-sm text-ink-3">
          Set up the{" "}
          <Link
            href={`/customers/${task.customerId}/accounting/accounts`}
            className="text-fmu-navy underline"
          >
            chart of accounts
          </Link>{" "}
          before importing a statement.
        </div>
      )}

      {/* Bank account picker */}
      {!posted && accounts !== undefined && accounts.length > 0 && (
        <section className="mt-6 space-y-2">
          <div className="eyebrow">Bank account</div>
          {newBank ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card p-3">
              <Labeled label="Name">
                <input
                  value={newBank.name}
                  onChange={(e) =>
                    setNewBank({ ...newBank, name: e.target.value })
                  }
                  placeholder="MCB current"
                  className="rounded border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy"
                />
              </Labeled>
              <Labeled label="Ledger (bank) account">
                <select
                  value={newBank.code}
                  onChange={(e) =>
                    setNewBank({ ...newBank, code: e.target.value })
                  }
                  className="rounded border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy"
                >
                  <option value="">Select…</option>
                  {accounts.map((a) => (
                    <option key={a._id} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Button
                size="sm"
                disabled={busy || !newBank.name.trim() || !newBank.code}
                onClick={() => void addBankAccount()}
              >
                Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNewBank(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={bankAccountId}
                onChange={(e) => void chooseBank(e.target.value)}
                disabled={!editable}
                className="rounded border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-fmu-navy"
              >
                <option value="">Select bank account…</option>
                {(bankAccounts ?? []).map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                    {b.bankName ? ` (${b.bankName})` : ""}
                  </option>
                ))}
              </select>
              {editable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNewBank({ name: "", code: "" })}
                >
                  Add bank account
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Upload + column map (when no lines yet) */}
      {editable && lines.length === 0 && !posted && (
        <section className="mt-6 space-y-3">
          {!parsed ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3 hover:bg-card-tint">
              <Upload className="h-4 w-4" />
              Upload a bank statement CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
          ) : (
            <div className="space-y-3 rounded-xl border border-line bg-card p-4">
              <div className="eyebrow">Map columns</div>
              <div className="flex flex-wrap gap-3">
                <ColumnSelect
                  label="Date"
                  headers={parsed.headers}
                  value={columnMap?.date ?? ""}
                  onChange={(v) =>
                    setColumnMap((m) => ({ ...(m as ColumnMap), date: v }))
                  }
                />
                <ColumnSelect
                  label="Description"
                  headers={parsed.headers}
                  value={columnMap?.description ?? ""}
                  onChange={(v) =>
                    setColumnMap((m) => ({
                      ...(m as ColumnMap),
                      description: v,
                    }))
                  }
                />
                <ColumnSelect
                  label="Amount (signed)"
                  headers={parsed.headers}
                  value={columnMap?.amount ?? ""}
                  optional
                  onChange={(v) =>
                    setColumnMap((m) => ({
                      ...(m as ColumnMap),
                      amount: v || undefined,
                    }))
                  }
                />
                <ColumnSelect
                  label="Debit (out)"
                  headers={parsed.headers}
                  value={columnMap?.debit ?? ""}
                  optional
                  onChange={(v) =>
                    setColumnMap((m) => ({
                      ...(m as ColumnMap),
                      debit: v || undefined,
                    }))
                  }
                />
                <ColumnSelect
                  label="Credit (in)"
                  headers={parsed.headers}
                  value={columnMap?.credit ?? ""}
                  optional
                  onChange={(v) =>
                    setColumnMap((m) => ({
                      ...(m as ColumnMap),
                      credit: v || undefined,
                    }))
                  }
                />
              </div>
              <p className="text-[11px] text-ink-4">
                Set a single signed <b>Amount</b> column, or separate{" "}
                <b>Debit</b> and <b>Credit</b> columns. {parsed.rows.length}{" "}
                rows found.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={importParsed}>
                  Import transactions
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setParsed(null);
                    setColumnMap(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Categorize / review */}
      {lines.length > 0 && (
        <section className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Statement lines</div>
            <span
              className={cn(
                "pill",
                coverage.ready ? "pill--balanced" : "pill--blocked",
              )}
            >
              <span className="num">{coverage.categorized}</span>/
              <span className="num">{coverage.total}</span> categorized
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line bg-bg-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  <th className="w-28 px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="w-28 px-3 py-2.5 text-right">Amount</th>
                  <th className="w-56 px-3 py-2.5">Category account</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.rowHash}
                    className="border-b border-line last:border-0"
                  >
                    <td className="num px-3 py-1.5 text-ink-3">
                      {l.date ? formatDate(l.date) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ink">{l.description}</td>
                    <td
                      className={cn(
                        "num px-3 py-1.5 text-right",
                        l.signedAmount < 0 ? "text-fmu-red" : "text-fmu-green",
                      )}
                    >
                      {l.signedAmount < 0 ? "−" : "+"}
                      {formatAmount(Math.abs(l.signedAmount))}
                    </td>
                    <td className="px-3 py-1.5">
                      {editable ? (
                        <select
                          value={l.accountCode ?? ""}
                          onChange={(e) =>
                            setLineAccount(l.rowHash, e.target.value)
                          }
                          className={cn(
                            "w-full rounded border bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy",
                            l.accountCode ? "border-line" : "border-fmu-yellow",
                          )}
                        >
                          <option value="">Uncategorized…</option>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Actions */}
      <section className="mt-8 border-t border-line pt-6">
        {posted ? (
          <div className="space-y-3">
            <p className="text-[12px] text-fmu-green">
              Posted to the ledger
              {postedBankName ? (
                <>
                  {" "}
                  against{" "}
                  <span className="font-medium text-ink">{postedBankName}</span>
                </>
              ) : null}
              .{" "}
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
                  Reason for reopening (reverses the posted batch)
                </label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={2}
                  autoFocus
                  className="w-full rounded border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-fmu-navy"
                />
                <div className="flex gap-2">
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
        ) : lines.length > 0 ? (
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
              disabled={busy || !ready}
              onClick={() => void transition("firm_approved")}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Approve &amp; post
            </Button>
            {!ready && (
              <span className="ml-auto text-[11px] text-ink-3">
                {bankAccountId
                  ? "Categorize every line to post"
                  : "Choose a bank account and categorize every line"}
              </span>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      {children}
    </div>
  );
}

function ColumnSelect({
  label,
  headers,
  value,
  onChange,
  optional,
}: {
  label: string;
  headers: string[];
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <Labeled label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
      >
        <option value="">{optional ? "—" : "Select…"}</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </Labeled>
  );
}
