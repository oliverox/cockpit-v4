"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, RotateCcw, Sparkles, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskRendererProps } from "@/modules/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount, formatDate } from "@/lib/formatters";
import {
  type BankRecPayload,
  type ColumnMap,
  type LineMatch,
  type StatementLine,
  bankRecCoverage,
  guessColumnMap,
  hashText,
  mapRowsToLines,
  parseStatementCsv,
  suggestExactMatches,
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
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const extractStatement = useAction(
    api.modules.accounting.extract.extractStatement,
  );

  const server = (task.payload ?? {}) as BankRecPayload;
  const posted = task.status === "firm_approved";
  const editable = task.status === "draft" || task.status === "review";

  const [bankAccountId, setBankAccountId] = useState(server.bankAccountId ?? "");
  const [lines, setLines] = useState<StatementLine[]>(server.lines ?? []);
  const [matches, setMatches] = useState<LineMatch[]>(server.matches ?? []);
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
  const [extracting, setExtracting] = useState(false);
  // Statement metadata (set by AI PDF extraction; persisted with the payload).
  const [meta, setMeta] = useState<{
    sourceFormat?: "csv" | "pdf";
    bankName?: string;
    statementCurrency?: string;
    periodLabel?: string;
    openingBalance?: number;
    closingBalance?: number;
  }>({
    sourceFormat: server.sourceFormat,
    bankName: server.bankName,
    statementCurrency: server.statementCurrency,
    periodLabel: server.periodLabel,
    openingBalance: server.openingBalance,
    closingBalance: server.closingBalance,
  });

  const contraCode = (bankAccounts ?? []).find(
    (b) => b._id === bankAccountId,
  )?.ledgerAccountCode;
  // Unreconciled entries on this bank's ledger account — the only valid match
  // targets. Loads once a bank account is chosen.
  const candidatesQ = useQuery(
    api.modules.accounting.ledger.getUnreconciledEntries,
    contraCode && editable
      ? { customerId: task.customerId, accountCode: contraCode }
      : "skip",
  );

  const candidates = candidatesQ ?? [];
  const matchedHashes = new Set(matches.map((m) => m.rowHash));
  const matchedLedgerIds = new Set(matches.map((m) => m.ledgerEntryId));
  // Candidates not already claimed by another matched line.
  const availableCandidates = candidates.filter(
    (c) => !matchedLedgerIds.has(c._id),
  );
  const isResolved = (l: StatementLine) =>
    !!l.accountCode || matchedHashes.has(l.rowHash);
  // Deterministic exact-match suggestions over still-unresolved lines —
  // surfaced for the user to accept, never silently applied.
  const suggestions = suggestExactMatches(
    lines.filter((l) => !isResolved(l)),
    availableCandidates,
  );
  const suggestionByHash = new Map(suggestions.map((s) => [s.rowHash, s]));

  const coverage = bankRecCoverage(lines, matches);
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
      matches,
      ...meta,
      ...next,
    };
    const dates = merged.lines.map((l) => l.date);
    merged.periodStart = dates.length ? Math.min(...dates) : undefined;
    merged.periodEnd = dates.length ? Math.max(...dates) : undefined;
    await updateTask({ taskId, payload: merged });
  }

  async function onFile(file: File) {
    setError(null);
    setNotice(null);
    const isPdf =
      file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      await extractPdf(file);
      return;
    }
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

  /** Upload a PDF to storage, then have Claude extract it (Phase 3c). */
  async function extractPdf(file: File) {
    setExtracting(true);
    setError(null);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed — try again.");
      const { storageId } = (await res.json()) as { storageId: string };
      const out = await extractStatement({
        taskId,
        storageId: storageId as Id<"_storage">,
        fileName: file.name,
      });
      const nextMeta = {
        sourceFormat: "pdf" as const,
        bankName: out.meta.bankName,
        statementCurrency: out.meta.currency,
        periodLabel: out.meta.period,
        openingBalance: out.meta.openingBalance,
        closingBalance: out.meta.closingBalance,
      };
      setLines(out.lines);
      setMatches([]);
      setMeta(nextMeta);
      setHash(out.fileHash);
      await persist({
        lines: out.lines,
        matches: [],
        statementFileHash: out.fileHash,
        ...nextMeta,
      });
      const skip =
        out.skipped.length > 0 ? ` ${out.skipped.length} row(s) skipped.` : "";
      const trunc = out.truncated
        ? " Output was truncated — double-check the last rows."
        : "";
      setNotice(
        `AI extracted ${out.lines.length} transactions from the PDF — review each line before posting.${skip}${trunc}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
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
    setMatches([]);
    // Clear any prior PDF-extraction metadata — this is a CSV import now.
    const csvMeta = {
      sourceFormat: "csv" as const,
      bankName: undefined,
      statementCurrency: undefined,
      periodLabel: undefined,
      openingBalance: undefined,
      closingBalance: undefined,
    };
    setMeta(csvMeta);
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
    void persist({ lines: mapped, matches: [], ...csvMeta });
  }

  /** Set a line's treatment from the unified dropdown: "match:<ledgerId>",
   *  "cat:<accountCode>", or "" (clear). Match and category are mutually
   *  exclusive per line. */
  function setTreatment(line: StatementLine, value: string) {
    let nextMatches = matches.filter((m) => m.rowHash !== line.rowHash);
    let nextLines = lines;
    if (value.startsWith("match:")) {
      const ledgerEntryId = value.slice(6);
      const cand = candidates.find((c) => c._id === ledgerEntryId);
      if (!cand) return;
      nextMatches = [
        ...nextMatches,
        {
          rowHash: line.rowHash,
          ledgerEntryId,
          matchType: "manual",
          ledgerDate: cand.date,
          ledgerDescription: cand.description,
          ledgerAmount: cand.signedAmount,
        },
      ];
      nextLines = lines.map((l) =>
        l.rowHash === line.rowHash ? { ...l, accountCode: undefined } : l,
      );
    } else if (value.startsWith("cat:")) {
      nextLines = lines.map((l) =>
        l.rowHash === line.rowHash ? { ...l, accountCode: value.slice(4) } : l,
      );
    } else {
      nextLines = lines.map((l) =>
        l.rowHash === line.rowHash ? { ...l, accountCode: undefined } : l,
      );
    }
    setMatches(nextMatches);
    setLines(nextLines);
    void persist({ lines: nextLines, matches: nextMatches });
  }

  function acceptSuggestion(line: StatementLine, s: LineMatch) {
    const nextMatches = [
      ...matches.filter((m) => m.rowHash !== line.rowHash),
      s,
    ];
    const nextLines = lines.map((l) =>
      l.rowHash === line.rowHash ? { ...l, accountCode: undefined } : l,
    );
    setMatches(nextMatches);
    setLines(nextLines);
    void persist({ lines: nextLines, matches: nextMatches });
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
          {extracting ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting transactions from the PDF with AI…
            </div>
          ) : !parsed ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3 hover:bg-card-tint">
              <Upload className="h-4 w-4" />
              Upload a bank statement — CSV or PDF
              <input
                type="file"
                accept=".csv,.pdf,text/csv,application/pdf"
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

      {/* Statement metadata (AI-extracted PDF or captured balances) */}
      {lines.length > 0 &&
        (meta.sourceFormat === "pdf" ||
          meta.bankName ||
          meta.openingBalance !== undefined ||
          meta.closingBalance !== undefined) && (
          <section className="mt-6 rounded-xl border border-line bg-card-tint/40 px-4 py-3 text-[12px] text-ink-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {meta.sourceFormat === "pdf" && (
                <span className="inline-flex items-center gap-1 font-medium text-fmu-navy">
                  <Sparkles className="h-3.5 w-3.5" /> AI-extracted from PDF —
                  review each line
                </span>
              )}
              {meta.bankName && <span>{meta.bankName}</span>}
              {meta.periodLabel && <span>{meta.periodLabel}</span>}
              {meta.statementCurrency && (
                <span className="num">{meta.statementCurrency}</span>
              )}
              {meta.openingBalance !== undefined && (
                <span>
                  Opening{" "}
                  <span className="num">
                    {formatAmount(meta.openingBalance)}
                  </span>
                </span>
              )}
              {meta.closingBalance !== undefined && (
                <span>
                  Closing{" "}
                  <span className="num">
                    {formatAmount(meta.closingBalance)}
                  </span>
                </span>
              )}
            </div>
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
              <span className="num">{coverage.resolved}</span>/
              <span className="num">{coverage.total}</span> resolved
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line bg-bg-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  <th className="w-28 px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="w-28 px-3 py-2.5 text-right">Amount</th>
                  <th className="w-72 px-3 py-2.5">Match or categorize</th>
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
                        <div className="space-y-1">
                          <select
                            value={
                              matchedHashes.has(l.rowHash)
                                ? `match:${matches.find((m) => m.rowHash === l.rowHash)!.ledgerEntryId}`
                                : l.accountCode
                                  ? `cat:${l.accountCode}`
                                  : ""
                            }
                            onChange={(e) => setTreatment(l, e.target.value)}
                            className={cn(
                              "w-full rounded border bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy",
                              isResolved(l)
                                ? "border-line"
                                : "border-fmu-yellow",
                            )}
                          >
                            <option value="">Choose…</option>
                            {(availableCandidates.length > 0 ||
                              matchedHashes.has(l.rowHash)) && (
                              <optgroup label="Match an existing entry">
                                {matchedHashes.has(l.rowHash) &&
                                  (() => {
                                    const lm = matches.find(
                                      (m) => m.rowHash === l.rowHash,
                                    )!;
                                    return (
                                      <option
                                        value={`match:${lm.ledgerEntryId}`}
                                      >
                                        {formatDate(lm.ledgerDate)} ·{" "}
                                        {lm.ledgerDescription} ·{" "}
                                        {fmtSigned(lm.ledgerAmount)} (matched)
                                      </option>
                                    );
                                  })()}
                                {availableCandidates.map((c) => (
                                  <option key={c._id} value={`match:${c._id}`}>
                                    {formatDate(c.date)} · {c.description} ·{" "}
                                    {fmtSigned(c.signedAmount)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="Post as new — category">
                              {(accounts ?? []).map((a) => (
                                <option key={a._id} value={`cat:${a.code}`}>
                                  {a.code} — {a.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          {!isResolved(l) &&
                            suggestionByHash.has(l.rowHash) && (
                              <button
                                type="button"
                                onClick={() =>
                                  acceptSuggestion(
                                    l,
                                    suggestionByHash.get(l.rowHash)!,
                                  )
                                }
                                className="block text-left text-[10px] text-fmu-navy hover:underline"
                              >
                                Suggested:{" "}
                                {suggestionByHash.get(l.rowHash)!
                                  .ledgerDescription}{" "}
                                — accept
                              </button>
                            )}
                        </div>
                      ) : (
                        <span className="num text-ink-2">
                          {matchedHashes.has(l.rowHash)
                            ? "Matched"
                            : l.accountCode}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-4 text-[11px] text-ink-3">
              <span>
                <span className="num">{matches.length}</span> matched
              </span>
              <span>
                <span className="num">
                  {lines.filter((l) => !!l.accountCode).length}
                </span>{" "}
                new
              </span>
              <span>
                <span className="num">{availableCandidates.length}</span>{" "}
                ledger entries still unreconciled
              </span>
            </div>
          )}
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
                  ? "Match or categorize every line to post"
                  : "Choose a bank account and resolve every line"}
              </span>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Signed money: "+1,234.50" / "−1,234.50". */
function fmtSigned(n: number): string {
  return `${n < 0 ? "−" : "+"}${formatAmount(Math.abs(n))}`;
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
