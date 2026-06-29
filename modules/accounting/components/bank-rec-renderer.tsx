"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link2,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskRendererProps } from "@/modules/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount, formatDate } from "@/lib/formatters";
import { round2 } from "@/modules/accounting/lib/journal-entry";
import {
  type BankRecPayload,
  type ColumnMap,
  type FixItem,
  type LedgerTxn,
  type MatchGroup,
  type StatementLine,
  bankRecVariance,
  effectiveMatchGroups,
  guessColumnMap,
  hashText,
  mapRowsToLines,
  parseAmount,
  parseStatementCsv,
  reconcileToZero,
  suggestExactMatches,
} from "@/modules/accounting/lib/bank-statement";

type Parsed = { headers: string[]; rows: Record<string, string>[] };
type WizardStep = "bank" | "ledger" | "reconcile" | "report";
type Candidate = {
  _id: string;
  date: number;
  description: string;
  accountName?: string;
  signedAmount: number;
};

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "bank", label: "Bank statement" },
  { key: "ledger", label: "Ledger" },
  { key: "reconcile", label: "Reconcile" },
  { key: "report", label: "Report" },
];

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
  const aiMatch = useAction(api.modules.accounting.match.aiMatch);
  const ensureSuspense = useMutation(
    api.modules.accounting.accounts.ensureSuspenseAccount,
  );

  const server = (task.payload ?? {}) as BankRecPayload;
  const posted = task.status === "firm_approved";
  const editable = task.status === "draft" || task.status === "review";

  const [bankAccountId, setBankAccountId] = useState(server.bankAccountId ?? "");
  const [lines, setLines] = useState<StatementLine[]>(server.lines ?? []);
  const [matchGroups, setMatchGroups] = useState<MatchGroup[]>(() =>
    effectiveMatchGroups(server),
  );
  const [hash, setHash] = useState(server.statementFileHash ?? "");
  // CSV hash is computed at parse time but only committed to `hash` on import,
  // so cancelling the column-map step never leaves a hash for an un-imported
  // file (which would weaken finalize's duplicate-import guard).
  const [pendingHash, setPendingHash] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);
  const [step, setStep] = useState<WizardStep>(
    server.step ?? ((server.lines?.length ?? 0) > 0 ? "reconcile" : "bank"),
  );
  const [selBank, setSelBank] = useState<Set<string>>(new Set());
  const [selLedger, setSelLedger] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [newBank, setNewBank] = useState<{ name: string; code: string } | null>(
    null,
  );
  const [extracting, setExtracting] = useState(false);
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
  const [openingStr, setOpeningStr] = useState(
    server.openingBalance != null ? String(server.openingBalance) : "",
  );
  const [closingStr, setClosingStr] = useState(
    server.closingBalance != null ? String(server.closingBalance) : "",
  );
  const [ackVariance, setAckVariance] = useState(false);

  // ── Mode A (uploaded cashbook as the ledger side) ──
  const [ledgerSource, setLedgerSource] = useState<"existing" | "cashbook">(
    server.ledgerSource ?? "existing",
  );
  const [ledgerTxns, setLedgerTxns] = useState<LedgerTxn[]>(
    server.ledgerTxns ?? [],
  );
  const [cashbookHash, setCashbookHash] = useState(server.cashbookFileHash ?? "");
  const [cashbookPendingHash, setCashbookPendingHash] = useState("");
  const [cashbookParsed, setCashbookParsed] = useState<Parsed | null>(null);
  const [cashbookColumnMap, setCashbookColumnMap] = useState<ColumnMap | null>(
    null,
  );
  const [extractingCashbook, setExtractingCashbook] = useState(false);
  const [cashbookMeta, setCashbookMeta] = useState<{
    opening?: number;
    closing?: number;
    bankName?: string;
    period?: string;
  }>({ opening: server.cashbookOpening, closing: server.cashbookClosing });
  const [cashbookOpeningStr, setCashbookOpeningStr] = useState(
    server.cashbookOpening != null ? String(server.cashbookOpening) : "",
  );
  const [cashbookClosingStr, setCashbookClosingStr] = useState(
    server.cashbookClosing != null ? String(server.cashbookClosing) : "",
  );
  const modeA = ledgerSource === "cashbook";

  // A line / match / balance edit invalidates a prior variance acknowledgement.
  useEffect(() => {
    setAckVariance(false);
  }, [
    lines,
    matchGroups,
    ledgerTxns,
    meta.openingBalance,
    meta.closingBalance,
    cashbookMeta.closing,
  ]);

  const contraCode = (bankAccounts ?? []).find(
    (b) => b._id === bankAccountId,
  )?.ledgerAccountCode;
  // Unreconciled entries on this bank's ledger account — the only valid match
  // targets. Still-unmatched-in-the-DB during the wizard, so matched-but-not-
  // posted entries remain here and resolve group ledger details.
  const candidatesQ = useQuery(
    api.modules.accounting.ledger.getUnreconciledEntries,
    contraCode && editable && !modeA
      ? { customerId: task.customerId, accountCode: contraCode }
      : "skip",
  );
  // The match targets ("candidates"): Mode B → unreconciled Convex ledger
  // entries; Mode A → the uploaded cashbook lines (ids are the LedgerTxn ids the
  // match groups + finalize reference).
  const candidates: Candidate[] = modeA
    ? ledgerTxns.map((t) => ({
        _id: t.id,
        date: t.date,
        description: t.description,
        signedAmount: t.signedAmount,
      }))
    : (candidatesQ ?? []);
  const candById = useMemo(
    () => new Map(candidates.map((c) => [c._id, c])),
    [candidates],
  );
  const lineByHash = useMemo(
    () => new Map(lines.map((l) => [l.rowHash, l])),
    [lines],
  );

  const matchedBankHashes = useMemo(
    () => new Set(matchGroups.flatMap((g) => g.bankRowHashes)),
    [matchGroups],
  );
  const claimedLedger = useMemo(
    () => new Set(matchGroups.flatMap((g) => g.ledgerRefs)),
    [matchGroups],
  );
  const availableCandidates = candidates.filter((c) => !claimedLedger.has(c._id));

  const isMatched = (l: StatementLine) => matchedBankHashes.has(l.rowHash);
  const isResolved = (l: StatementLine) => isMatched(l) || !!l.accountCode;
  const resolvedCount = lines.filter(isResolved).length;
  const coverageReady = lines.length > 0 && resolvedCount === lines.length;

  // Deterministic exact-match suggestions over still-unresolved lines.
  const suggestions = suggestExactMatches(
    lines.filter((l) => !isResolved(l)),
    availableCandidates,
  );

  const variance = bankRecVariance(
    lines,
    meta.openingBalance,
    meta.closingBalance,
  );

  // Mode A two-sided reconciliation: bank closing vs cashbook closing, after the
  // unmatched items on either side (each signed as the ledger adjustment needed).
  const reconcileItems: FixItem[] = modeA
    ? [
        ...lines
          .filter((l) => !isMatched(l))
          .map((l) => ({
            date: l.date,
            description: l.description,
            amount: l.signedAmount,
          })),
        ...ledgerTxns
          .filter((t) => !claimedLedger.has(t.id))
          .map((t) => ({
            date: t.date,
            description: t.description,
            amount: -t.signedAmount,
          })),
      ]
    : [];
  const twoSided =
    modeA && meta.closingBalance != null && cashbookMeta.closing != null
      ? reconcileToZero(meta.closingBalance, cashbookMeta.closing, reconcileItems)
      : null;

  // Soft gate variance, unified across modes: null = unknown balances (never
  // blocks); tied within 0.02 = ok; otherwise needs acknowledgement.
  const gateVariance = modeA
    ? twoSided
      ? twoSided.residual
      : null
    : variance.variance;
  const gateTied = modeA
    ? twoSided === null || Math.abs(twoSided.residual) <= 0.02
    : variance.tied;
  const varianceOk = gateVariance === null || gateTied || ackVariance;

  // Mirror finalize's per-mutation write bound (it imports ~2N rows in Mode A).
  const overCap = lines.length + (modeA ? ledgerTxns.length : 0) > 500;
  const ready =
    coverageReady &&
    !!bankAccountId &&
    (accounts?.length ?? 0) > 0 &&
    varianceOk &&
    !overCap;

  const canLeaveBank = lines.length > 0 && !!bankAccountId;
  const canLeaveLedger = !modeA || ledgerTxns.length > 0;
  const postedBankName = (bankAccounts ?? []).find(
    (b) => b._id === (server.bankAccountId ?? bankAccountId),
  )?.name;

  async function persist(next?: Partial<BankRecPayload>) {
    // Base on the server payload so fields this wizard doesn't model
    // (aiMatch, ledgerSource/modeAVariant, ledgerTxns + cashbook*) survive a
    // save; the locally-managed fields below override it. (Single-editor
    // assumption: local state is only seeded once from the server — a second
    // concurrent editor's changes are last-writer-wins.)
    const merged: BankRecPayload = {
      ...server,
      bankAccountId,
      statementFileHash: hash,
      lines,
      // The wizard authors matchGroups; neutralise the legacy 1:1 field so
      // finalize's effectiveMatchGroups never double-counts.
      matches: [],
      matchGroups,
      step,
      ledgerSource,
      ledgerTxns,
      cashbookFileHash: cashbookHash || undefined,
      cashbookOpening: cashbookMeta.opening,
      cashbookClosing: cashbookMeta.closing,
      ...meta,
      ...next,
    };
    const dates = merged.lines.map((l) => l.date);
    merged.periodStart = dates.length ? Math.min(...dates) : undefined;
    merged.periodEnd = dates.length ? Math.max(...dates) : undefined;
    try {
      await updateTask({ taskId, payload: merged });
    } catch (e) {
      // Surface the failure (e.g. payload over Convex's 1MB limit) — local
      // state already reflects the edit, so without this the save looks done.
      setError(
        e instanceof Error ? `Couldn't save — ${e.message}` : "Couldn't save your changes.",
      );
    }
  }

  function goStep(s: WizardStep) {
    if (s !== "bank" && !canLeaveBank) return;
    if ((s === "reconcile" || s === "report") && !canLeaveLedger) return;
    setStep(s);
    setSelBank(new Set());
    setSelLedger(new Set());
    void persist({ step: s });
  }

  // ── Upload / ingest ────────────────────────────────────────────────
  async function onFile(file: File) {
    setError(null);
    setNotice(null);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      await extractPdf(file);
      return;
    }
    try {
      const text = await file.text();
      const res = parseStatementCsv(text);
      setParsed(res);
      setColumnMap(guessColumnMap(res.headers));
      setPendingHash(hashText(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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
      setMatchGroups([]);
      setMeta(nextMeta);
      setOpeningStr(
        nextMeta.openingBalance != null ? String(nextMeta.openingBalance) : "",
      );
      setClosingStr(
        nextMeta.closingBalance != null ? String(nextMeta.closingBalance) : "",
      );
      setHash(out.fileHash);
      await persist({
        lines: out.lines,
        matchGroups: [],
        statementFileHash: out.fileHash,
        ...nextMeta,
      });
      const skip =
        out.skipped.length > 0 ? ` ${out.skipped.length} row(s) skipped.` : "";
      const trunc = out.truncated
        ? " Output was truncated — double-check the last rows."
        : "";
      setNotice(
        `AI extracted ${out.lines.length} transactions — review each line, then reconcile.${skip}${trunc}`,
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
    setMatchGroups([]);
    setHash(pendingHash);
    const csvMeta = {
      sourceFormat: "csv" as const,
      bankName: undefined,
      statementCurrency: undefined,
      periodLabel: undefined,
      openingBalance: undefined,
      closingBalance: undefined,
    };
    setMeta(csvMeta);
    setOpeningStr("");
    setClosingStr("");
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
    void persist({
      lines: mapped,
      matchGroups: [],
      statementFileHash: pendingHash,
      ...csvMeta,
    });
  }

  function removeLine(rowHash: string) {
    const nextLines = lines.filter((l) => l.rowHash !== rowHash);
    // A removed line that belonged to a group invalidates the WHOLE group (its
    // ledger side balanced against the full bank side), so drop the group
    // entirely — releasing its ledger refs — never leave a partial split.
    const nextGroups = matchGroups.filter(
      (g) => !g.bankRowHashes.includes(rowHash),
    );
    setLines(nextLines);
    setMatchGroups(nextGroups);
    void persist({ lines: nextLines, matchGroups: nextGroups });
  }

  // ── Mode A: cashbook ingestion ─────────────────────────────────────
  async function setSourceMode(src: "existing" | "cashbook") {
    if (src === ledgerSource) return;
    // Switching the ledger source invalidates existing matches — their refs
    // point at the other source.
    setLedgerSource(src);
    setMatchGroups([]);
    setSelBank(new Set());
    setSelLedger(new Set());
    if (src === "cashbook") {
      try {
        await ensureSuspense({ customerId: task.customerId });
      } catch {
        /* finalize re-asserts Suspense exists; non-fatal here */
      }
    }
    await persist({ ledgerSource: src, matchGroups: [] });
  }

  async function onCashbookFile(file: File) {
    setError(null);
    setNotice(null);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      await extractCashbookPdf(file);
      return;
    }
    try {
      const text = await file.text();
      const res = parseStatementCsv(text);
      setCashbookParsed(res);
      setCashbookColumnMap(guessColumnMap(res.headers));
      setCashbookPendingHash(hashText(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function extractCashbookPdf(file: File) {
    setExtractingCashbook(true);
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
      const txns = out.lines.map(toLedgerTxn);
      const next = {
        opening: out.meta.openingBalance,
        closing: out.meta.closingBalance,
        bankName: out.meta.bankName,
        period: out.meta.period,
      };
      setLedgerTxns(txns);
      setMatchGroups([]);
      setCashbookMeta(next);
      setCashbookOpeningStr(next.opening != null ? String(next.opening) : "");
      setCashbookClosingStr(next.closing != null ? String(next.closing) : "");
      setCashbookHash(out.fileHash);
      await persist({
        ledgerTxns: txns,
        matchGroups: [],
        cashbookFileHash: out.fileHash,
        cashbookOpening: next.opening,
        cashbookClosing: next.closing,
      });
      setNotice(`AI extracted ${txns.length} cashbook lines — review, then reconcile.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtractingCashbook(false);
    }
  }

  function importCashbookParsed() {
    if (!cashbookParsed || !cashbookColumnMap) return;
    const { lines: mapped, skipped } = mapRowsToLines(
      cashbookParsed.rows,
      cashbookColumnMap,
    );
    if (mapped.length === 0) {
      setError("No usable cashbook rows — check the column mapping.");
      return;
    }
    const txns = mapped.map(toLedgerTxn);
    setError(null);
    setLedgerTxns(txns);
    setMatchGroups([]);
    setCashbookMeta({ opening: undefined, closing: undefined });
    setCashbookOpeningStr("");
    setCashbookClosingStr("");
    setCashbookHash(cashbookPendingHash);
    setCashbookParsed(null);
    setCashbookColumnMap(null);
    setNotice(
      skipped.length > 0
        ? `Imported ${mapped.length} cashbook rows — ${skipped.length} skipped.`
        : null,
    );
    void persist({
      ledgerTxns: txns,
      matchGroups: [],
      cashbookFileHash: cashbookPendingHash,
      cashbookOpening: undefined,
      cashbookClosing: undefined,
    });
  }

  function categorizeCashbook(id: string, accountCode: string) {
    const next = ledgerTxns.map((t) =>
      t.id === id ? { ...t, accountCode: accountCode || undefined } : t,
    );
    setLedgerTxns(next);
    void persist({ ledgerTxns: next });
  }

  function removeCashbookLine(id: string) {
    const next = ledgerTxns.filter((t) => t.id !== id);
    const nextGroups = matchGroups.filter((g) => !g.ledgerRefs.includes(id));
    setLedgerTxns(next);
    setMatchGroups(nextGroups);
    void persist({ ledgerTxns: next, matchGroups: nextGroups });
  }

  function editCashbookBalance(
    field: "opening" | "closing",
    raw: string,
    commit: boolean,
  ) {
    if (field === "opening") setCashbookOpeningStr(raw);
    else setCashbookClosingStr(raw);
    const t = raw.trim();
    const value = t === "" || !/\d/.test(t) ? undefined : parseAmount(t);
    setCashbookMeta((m) => ({ ...m, [field]: value }));
    if (commit) {
      void persist(
        field === "opening"
          ? { cashbookOpening: value }
          : { cashbookClosing: value },
      );
    }
  }

  // ── Matching ───────────────────────────────────────────────────────
  function toggleSel(set: Set<string>, setFn: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  }

  const selBankSigned = round2(
    [...selBank].reduce((s, h) => round2(s + (lineByHash.get(h)?.signedAmount ?? 0)), 0),
  );
  const selLedgerSigned = round2(
    [...selLedger].reduce((s, id) => round2(s + (candById.get(id)?.signedAmount ?? 0)), 0),
  );
  const selBalances =
    selBank.size > 0 &&
    selLedger.size > 0 &&
    Math.abs(selBankSigned - selLedgerSigned) <= 0.02;

  function createMatch() {
    // Re-validate the selection against LIVE claims (an AI run between selecting
    // and clicking could have claimed one of these), then re-check the balance.
    const bankRowHashes = [...selBank].filter((h) => !matchedBankHashes.has(h));
    const ledgerRefs = [...selLedger].filter((id) => !claimedLedger.has(id));
    if (bankRowHashes.length === 0 || ledgerRefs.length === 0) {
      setSelBank(new Set());
      setSelLedger(new Set());
      return;
    }
    const bankSigned = round2(
      bankRowHashes.reduce(
        (s, h) => round2(s + (lineByHash.get(h)?.signedAmount ?? 0)),
        0,
      ),
    );
    const ledgerSigned = round2(
      ledgerRefs.reduce(
        (s, id) => round2(s + (candById.get(id)?.signedAmount ?? 0)),
        0,
      ),
    );
    if (Math.abs(bankSigned - ledgerSigned) > 0.02) {
      setError("Selected bank and ledger amounts don't match — adjust your selection.");
      return;
    }
    const group: MatchGroup = {
      groupId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `m_${hashText(bankRowHashes.join("|") + ledgerRefs.join("|"))}`,
      bankRowHashes,
      ledgerRefs,
      source: "manual",
    };
    const nextLines = lines.map((l) =>
      bankRowHashes.includes(l.rowHash) ? { ...l, accountCode: undefined } : l,
    );
    const nextGroups = [...matchGroups, group];
    setLines(nextLines);
    setMatchGroups(nextGroups);
    setSelBank(new Set());
    setSelLedger(new Set());
    setError(null);
    void persist({ lines: nextLines, matchGroups: nextGroups });
  }

  function unmatch(groupId: string) {
    const nextGroups = matchGroups.filter((g) => g.groupId !== groupId);
    setMatchGroups(nextGroups);
    void persist({ matchGroups: nextGroups });
  }

  function acceptSuggestions() {
    if (suggestions.length === 0) return;
    const used = new Set<string>();
    const newGroups: MatchGroup[] = [];
    for (const s of suggestions) {
      if (used.has(s.ledgerEntryId)) continue;
      used.add(s.ledgerEntryId);
      newGroups.push({
        groupId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `s_${hashText(s.rowHash + s.ledgerEntryId)}`,
        bankRowHashes: [s.rowHash],
        ledgerRefs: [s.ledgerEntryId],
        source: "exact",
      });
    }
    const hashes = new Set(newGroups.flatMap((g) => g.bankRowHashes));
    const nextLines = lines.map((l) =>
      hashes.has(l.rowHash) ? { ...l, accountCode: undefined } : l,
    );
    const nextGroups = [...matchGroups, ...newGroups];
    setLines(nextLines);
    setMatchGroups(nextGroups);
    void persist({ lines: nextLines, matchGroups: nextGroups });
  }

  function categorize(rowHash: string, accountCode: string) {
    const nextGroups = matchGroups
      .map((g) => ({
        ...g,
        bankRowHashes: g.bankRowHashes.filter((h) => h !== rowHash),
      }))
      .filter((g) => g.bankRowHashes.length > 0);
    const nextLines = lines.map((l) =>
      l.rowHash === rowHash ? { ...l, accountCode: accountCode || undefined } : l,
    );
    setMatchGroups(nextGroups);
    setLines(nextLines);
    void persist({ lines: nextLines, matchGroups: nextGroups });
  }

  async function autoMatch() {
    setAiBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Persist current manual matches so the action's gate reads the latest.
      await persist();
      const out = await aiMatch({ taskId });
      // Adopt the server's merged groups SYNCHRONOUSLY (the action returns them)
      // rather than waiting for the reactive aiRanAt effect — a persist in that
      // window would otherwise clobber the freshly-written AI groups. Clear any
      // stale selection too.
      if (out.groups) setMatchGroups(out.groups);
      setSelBank(new Set());
      setSelLedger(new Set());
      if (out.matched > 0) {
        setNotice(
          `AI matched ${out.matched} group(s). ${out.unmatchedBank} bank + ${out.unmatchedLedger} ledger still unmatched.` +
            (out.truncated ? " Output was truncated — run again to continue." : "") +
            (out.candidateCapped || out.bankCapped
              ? " (only the most recent transactions were sent — match the rest manually)"
              : ""),
        );
      } else {
        setNotice(out.note ?? "No further matches found — resolve the rest manually.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  // ── Bank account ───────────────────────────────────────────────────
  async function chooseBank(id: string) {
    // Switching accounts invalidates existing groups — their ledger refs are
    // entries on the OLD contra account (finalize would reject them). Clear the
    // groups + any selection so the user re-matches against the new account.
    const clear = id !== bankAccountId && matchGroups.length > 0;
    setBankAccountId(id);
    if (clear) {
      setMatchGroups([]);
      setSelBank(new Set());
      setSelLedger(new Set());
      await persist({ bankAccountId: id, matchGroups: [] });
    } else {
      await persist({ bankAccountId: id });
    }
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

  function editBalance(
    field: "openingBalance" | "closingBalance",
    raw: string,
    commit: boolean,
  ) {
    if (field === "openingBalance") setOpeningStr(raw);
    else setClosingStr(raw);
    const t = raw.trim();
    const value = t === "" || !/\d/.test(t) ? undefined : parseAmount(t);
    setMeta((m) => ({ ...m, [field]: value }));
    if (commit) void persist({ [field]: value });
  }

  async function transition(
    status: "review" | "firm_approved" | "draft",
    reason?: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      if (editable) {
        await persist(
          status === "firm_approved"
            ? {
                varianceAtPost: gateVariance ?? undefined,
                varianceAcknowledged:
                  gateVariance !== null && !gateTied ? true : undefined,
              }
            : undefined,
        );
      }
      await setStatus({ taskId, status, ...(reason ? { reason } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10">
      <header className="space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
          Bank reconciliation
          <span className="mx-2 text-ink-4">·</span>
          <span className={posted ? "text-fmu-green" : "text-ink-2"}>
            {posted ? "Posted" : task.status === "review" ? "In review" : "Draft"}
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

      {/* Stepper (hidden once posted — shows the read-only report) */}
      {!posted && (
        <nav className="mt-6 flex items-center gap-1">
          {STEPS.map((s, i) => {
            const active = s.key === step;
            const reachable =
              s.key === "bank" ||
              (canLeaveBank && (s.key === "ledger" || canLeaveLedger));
            return (
              <button
                key={s.key}
                type="button"
                disabled={!reachable}
                onClick={() => goStep(s.key)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-fmu-navy text-white"
                    : reachable
                      ? "text-ink-2 hover:bg-card-tint"
                      : "text-ink-4",
                )}
              >
                <span
                  className={cn(
                    "num flex h-4 w-4 items-center justify-center rounded-full text-[9px]",
                    active ? "bg-white/20" : "bg-line-2/60 text-ink-3",
                  )}
                >
                  {i + 1}
                </span>
                {s.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Step 1: Bank statement ── */}
      {!posted && step === "bank" && accounts !== undefined && accounts.length > 0 && (
        <section className="mt-6 space-y-5">
          <div className="space-y-2">
            <div className="eyebrow">Bank account</div>
            {newBank ? (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-card p-3">
                <Labeled label="Name">
                  <input
                    aria-label="New bank account name"
                    value={newBank.name}
                    onChange={(e) => setNewBank({ ...newBank, name: e.target.value })}
                    placeholder="MCB current"
                    className="rounded border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy"
                  />
                </Labeled>
                <Labeled label="Ledger (bank) account">
                  <select
                    aria-label="Ledger (bank) account for the new bank account"
                    value={newBank.code}
                    onChange={(e) => setNewBank({ ...newBank, code: e.target.value })}
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
                  aria-label="Bank account"
                  value={bankAccountId}
                  onChange={(e) => void chooseBank(e.target.value)}
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNewBank({ name: "", code: "" })}
                >
                  Add bank account
                </Button>
              </div>
            )}
          </div>

          {/* Ledger source */}
          <div className="space-y-2">
            <div className="eyebrow">Ledger source</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <SourceOption
                active={!modeA}
                title="Use my Cockpit ledger"
                desc="Reconcile against the entries already posted to this bank's account."
                onClick={() => void setSourceMode("existing")}
              />
              <SourceOption
                active={modeA}
                title="Upload a cashbook"
                desc="Books kept elsewhere — match against an uploaded ledger file."
                onClick={() => void setSourceMode("cashbook")}
              />
            </div>
          </div>

          {/* Upload / column map */}
          <div className="space-y-2">
            <div className="eyebrow">Statement</div>
            {extracting ? (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting transactions from the PDF with AI…
              </div>
            ) : parsed ? (
              <div className="space-y-3 rounded-xl border border-line bg-card p-4">
                <div className="eyebrow">Map columns</div>
                <div className="flex flex-wrap gap-3">
                  <ColumnSelect
                    label="Date"
                    headers={parsed.headers}
                    value={columnMap?.date ?? ""}
                    onChange={(v) => setColumnMap((m) => ({ ...(m as ColumnMap), date: v }))}
                  />
                  <ColumnSelect
                    label="Description"
                    headers={parsed.headers}
                    value={columnMap?.description ?? ""}
                    onChange={(v) =>
                      setColumnMap((m) => ({ ...(m as ColumnMap), description: v }))
                    }
                  />
                  <ColumnSelect
                    label="Amount (signed)"
                    headers={parsed.headers}
                    value={columnMap?.amount ?? ""}
                    optional
                    onChange={(v) =>
                      setColumnMap((m) => ({ ...(m as ColumnMap), amount: v || undefined }))
                    }
                  />
                  <ColumnSelect
                    label="Debit (out)"
                    headers={parsed.headers}
                    value={columnMap?.debit ?? ""}
                    optional
                    onChange={(v) =>
                      setColumnMap((m) => ({ ...(m as ColumnMap), debit: v || undefined }))
                    }
                  />
                  <ColumnSelect
                    label="Credit (in)"
                    headers={parsed.headers}
                    value={columnMap?.credit ?? ""}
                    optional
                    onChange={(v) =>
                      setColumnMap((m) => ({ ...(m as ColumnMap), credit: v || undefined }))
                    }
                  />
                </div>
                <p className="text-[11px] text-ink-4">
                  Set a single signed <b>Amount</b> column, or separate <b>Debit</b> and{" "}
                  <b>Credit</b> columns. {parsed.rows.length} rows found.
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
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3 hover:bg-card-tint focus-within:border-fmu-navy focus-within:ring-2 focus-within:ring-fmu-navy/30">
                <Upload className="h-4 w-4" />
                {lines.length > 0
                  ? "Replace the statement — upload a CSV or PDF"
                  : "Upload a bank statement — CSV or PDF"}
                {/* sr-only (not hidden) keeps the input in the tab order so the
                    upload is reachable by keyboard. */}
                <input
                  type="file"
                  accept=".csv,.pdf,text/csv,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </label>
            )}
          </div>

          {/* Extracted lines + balances */}
          {lines.length > 0 && (
            <>
              <ReconStatement
                meta={meta}
                variance={variance}
                editable
                openingStr={openingStr}
                closingStr={closingStr}
                onEditBalance={editBalance}
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="eyebrow">
                    {lines.length} statement line{lines.length === 1 ? "" : "s"}
                  </div>
                </div>
                <LinesTable lines={lines} onRemove={removeLine} />
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Step 2: Ledger — Mode B preview ── */}
      {!posted && step === "ledger" && !modeA && (
        <section className="mt-6 space-y-3">
          <div className="eyebrow">Ledger — unreconciled entries</div>
          <p className="text-[12px] text-ink-3">
            These are the unposted-against entries on{" "}
            <span className="font-medium text-ink-2">{contraName(bankAccounts, bankAccountId)}</span>
            's ledger account — the candidates the statement reconciles against. Bank
            lines you don't match here will post as new ledger entries.
          </p>
          {candidatesQ === undefined ? (
            <div className="rounded-xl border border-line bg-card px-4 py-6 text-sm text-ink-3">
              Loading ledger entries…
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-4 py-6 text-sm text-ink-3">
              No unreconciled ledger entries on this account — every statement line will
              post as a new entry.
            </div>
          ) : (
            <CandidatesTable rows={candidates} claimed={claimedLedger} />
          )}
        </section>
      )}

      {/* ── Step 2: Ledger — Mode A cashbook upload ── */}
      {!posted && step === "ledger" && modeA && (
        <section className="mt-6 space-y-5">
          <div className="space-y-2">
            <div className="eyebrow">Cashbook</div>
            <p className="text-[12px] text-ink-3">
              Upload your company's cashbook for this account. On approval each
              line imports into the ledger; lines you don't match to the bank
              statement import as outstanding items. Uncategorized lines post to
              Suspense (10850) to reclassify later.
            </p>
            {extractingCashbook ? (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting the cashbook from the PDF with AI…
              </div>
            ) : cashbookParsed ? (
              <div className="space-y-3 rounded-xl border border-line bg-card p-4">
                <div className="eyebrow">Map columns</div>
                <div className="flex flex-wrap gap-3">
                  <ColumnSelect
                    label="Date"
                    headers={cashbookParsed.headers}
                    value={cashbookColumnMap?.date ?? ""}
                    onChange={(v) => setCashbookColumnMap((m) => ({ ...(m as ColumnMap), date: v }))}
                  />
                  <ColumnSelect
                    label="Description"
                    headers={cashbookParsed.headers}
                    value={cashbookColumnMap?.description ?? ""}
                    onChange={(v) =>
                      setCashbookColumnMap((m) => ({ ...(m as ColumnMap), description: v }))
                    }
                  />
                  <ColumnSelect
                    label="Amount (signed)"
                    headers={cashbookParsed.headers}
                    value={cashbookColumnMap?.amount ?? ""}
                    optional
                    onChange={(v) =>
                      setCashbookColumnMap((m) => ({ ...(m as ColumnMap), amount: v || undefined }))
                    }
                  />
                  <ColumnSelect
                    label="Debit (out)"
                    headers={cashbookParsed.headers}
                    value={cashbookColumnMap?.debit ?? ""}
                    optional
                    onChange={(v) =>
                      setCashbookColumnMap((m) => ({ ...(m as ColumnMap), debit: v || undefined }))
                    }
                  />
                  <ColumnSelect
                    label="Credit (in)"
                    headers={cashbookParsed.headers}
                    value={cashbookColumnMap?.credit ?? ""}
                    optional
                    onChange={(v) =>
                      setCashbookColumnMap((m) => ({ ...(m as ColumnMap), credit: v || undefined }))
                    }
                  />
                </div>
                <p className="text-[11px] text-ink-4">{cashbookParsed.rows.length} rows found.</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={importCashbookParsed}>
                    Import cashbook
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCashbookParsed(null);
                      setCashbookColumnMap(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-8 text-sm text-ink-3 hover:bg-card-tint focus-within:border-fmu-navy focus-within:ring-2 focus-within:ring-fmu-navy/30">
                <Upload className="h-4 w-4" />
                {ledgerTxns.length > 0
                  ? "Replace the cashbook — upload a CSV or PDF"
                  : "Upload your cashbook — CSV or PDF"}
                <input
                  type="file"
                  accept=".csv,.pdf,text/csv,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onCashbookFile(f);
                  }}
                />
              </label>
            )}
          </div>

          {ledgerTxns.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-card-tint/40 p-4">
                <BalanceField
                  label="Cashbook opening"
                  editable
                  strValue={cashbookOpeningStr}
                  numValue={cashbookMeta.opening}
                  onChange={(v) => editCashbookBalance("opening", v, false)}
                  onCommit={(v) => editCashbookBalance("opening", v, true)}
                />
                <BalanceField
                  label="Cashbook closing"
                  editable
                  strValue={cashbookClosingStr}
                  numValue={cashbookMeta.closing}
                  onChange={(v) => editCashbookBalance("closing", v, false)}
                  onCommit={(v) => editCashbookBalance("closing", v, true)}
                />
              </div>
              <div className="space-y-2">
                <div className="eyebrow">
                  {ledgerTxns.length} cashbook line{ledgerTxns.length === 1 ? "" : "s"}
                </div>
                <div className="overflow-x-auto rounded-xl border border-line bg-card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line bg-card-tint/40 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                        <th className="w-28 px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Description</th>
                        <th className="w-28 px-3 py-2.5 text-right">Amount</th>
                        <th className="w-56 px-3 py-2.5">Category (optional)</th>
                        <th className="w-10 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerTxns.map((t) => (
                        <tr key={t.id} className="border-b border-line last:border-0">
                          <td className="num px-3 py-1.5 text-ink-3">{formatDate(t.date)}</td>
                          <td className="px-3 py-1.5 text-ink">{t.description}</td>
                          <td
                            className={cn(
                              "num px-3 py-1.5 text-right",
                              t.signedAmount < 0 ? "text-fmu-red" : "text-fmu-green",
                            )}
                          >
                            {fmtSigned(t.signedAmount)}
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              aria-label={`Category for ${t.description}`}
                              value={t.accountCode ? `cat:${t.accountCode}` : ""}
                              onChange={(e) =>
                                categorizeCashbook(
                                  t.id,
                                  e.target.value.startsWith("cat:")
                                    ? e.target.value.slice(4)
                                    : "",
                                )
                              }
                              className="w-full rounded border border-line bg-card px-1 py-0.5 text-[11px] outline-none focus:border-fmu-navy"
                            >
                              <option value="">Suspense (10850)</option>
                              {(accounts ?? []).map((a) => (
                                <option key={a._id} value={`cat:${a.code}`}>
                                  {a.code} — {a.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeCashbookLine(t.id)}
                              aria-label="Remove cashbook line"
                              className="text-ink-4 hover:text-fmu-red"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Step 3: Reconcile ── */}
      {!posted && step === "reconcile" && (
        <section className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="eyebrow">Reconcile</div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "pill",
                  coverageReady ? "pill--balanced" : "pill--blocked",
                )}
              >
                <span className="num">{resolvedCount}</span>/
                <span className="num">{lines.length}</span> resolved
              </span>
              {suggestions.length > 0 && (
                <Button size="sm" variant="outline" onClick={acceptSuggestions}>
                  <Check className="h-3.5 w-3.5" />
                  Accept {suggestions.length} exact
                </Button>
              )}
              <Button size="sm" disabled={aiBusy} onClick={() => void autoMatch()}>
                {aiBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Auto-match remaining
              </Button>
            </div>
          </div>

          {/* Create-match bar */}
          {(selBank.size > 0 || selLedger.size > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-fmu-navy/30 bg-fmu-navy/5 px-3 py-2 text-[12px]">
              <span className="text-ink-2">
                <span className="num">{selBank.size}</span> bank (
                <span className="num">{fmtSigned(selBankSigned)}</span>) ·{" "}
                <span className="num">{selLedger.size}</span> ledger (
                <span className="num">{fmtSigned(selLedgerSigned)}</span>)
                {selBank.size > 0 && selLedger.size > 0 && !selBalances && (
                  <span className="ml-2 text-fmu-red">
                    off by {fmtSigned(round2(selBankSigned - selLedgerSigned))}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!selBalances} onClick={createMatch}>
                  <Link2 className="h-3.5 w-3.5" />
                  Create match
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelBank(new Set());
                    setSelLedger(new Set());
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Bank column */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Bank statement
              </div>
              <div className="divide-y divide-line rounded-xl border border-line bg-card">
                {lines.map((l) => {
                  const matched = isMatched(l);
                  const selected = selBank.has(l.rowHash);
                  return (
                    <div
                      key={l.rowHash}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-xs",
                        matched && "bg-fmu-green/5",
                        selected && "bg-fmu-navy/5",
                      )}
                    >
                      {!matched && !l.accountCode ? (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSel(selBank, setSelBank, l.rowHash)}
                          aria-label={`Select ${l.description}`}
                        />
                      ) : (
                        <span className="w-3" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ink">{l.description}</div>
                        <div className="num text-[10px] text-ink-4">
                          {formatDate(l.date)}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "num shrink-0",
                          l.signedAmount < 0 ? "text-fmu-red" : "text-fmu-green",
                        )}
                      >
                        {fmtSigned(l.signedAmount)}
                      </span>
                      <span className="w-32 shrink-0 text-right">
                        {matched ? (
                          <span className="pill pill--balanced">matched</span>
                        ) : (
                          <select
                            aria-label={`Category for ${l.description} (${fmtSigned(l.signedAmount)})`}
                            value={l.accountCode ? `cat:${l.accountCode}` : ""}
                            onChange={(e) =>
                              categorize(
                                l.rowHash,
                                e.target.value.startsWith("cat:")
                                  ? e.target.value.slice(4)
                                  : "",
                              )
                            }
                            className={cn(
                              "w-full rounded border bg-card px-1 py-0.5 text-[11px] outline-none focus:border-fmu-navy",
                              l.accountCode ? "border-line" : "border-fmu-yellow/60",
                            )}
                          >
                            <option value="">New: category…</option>
                            {(accounts ?? []).map((a) => (
                              <option key={a._id} value={`cat:${a.code}`}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Ledger column */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                {modeA ? "Cashbook" : "Ledger (unreconciled)"}
              </div>
              <div className="divide-y divide-line rounded-xl border border-line bg-card">
                {!modeA && candidatesQ === undefined ? (
                  <div className="px-3 py-6 text-center text-[12px] text-ink-4">
                    Loading ledger entries…
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[12px] text-ink-4">
                    {modeA ? "No cashbook lines." : "No unreconciled ledger entries."}
                  </div>
                ) : (
                  candidates.map((c) => {
                    const claimed = claimedLedger.has(c._id);
                    const selected = selLedger.has(c._id);
                    return (
                      <div
                        key={c._id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 text-xs",
                          claimed && "bg-fmu-green/5",
                          selected && "bg-fmu-navy/5",
                        )}
                      >
                        {!claimed ? (
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSel(selLedger, setSelLedger, c._id)}
                            aria-label={`Select ${c.description}`}
                          />
                        ) : (
                          <span className="w-3" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-ink">{c.description}</div>
                          <div className="num text-[10px] text-ink-4">
                            {formatDate(c.date)}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "num shrink-0",
                            c.signedAmount < 0 ? "text-fmu-red" : "text-fmu-green",
                          )}
                        >
                          {fmtSigned(c.signedAmount)}
                        </span>
                        <span className="w-16 shrink-0 text-right">
                          {claimed && (
                            <span className="pill pill--balanced">matched</span>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Matched groups */}
          {matchGroups.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Matches ({matchGroups.length})
              </div>
              <div className="divide-y divide-line rounded-xl border border-line bg-card-tint/40">
                {matchGroups.map((g) => (
                  <MatchGroupRow
                    key={g.groupId}
                    group={g}
                    lineByHash={lineByHash}
                    candById={candById}
                    onUnmatch={() => unmatch(g.groupId)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Step 4: Report (also the posted read-only view) ── */}
      {(posted || step === "report") && lines.length > 0 && (
        <section className="mt-6 space-y-4">
          <ReconStatement
            meta={meta}
            variance={variance}
            editable={editable && step === "report"}
            openingStr={openingStr}
            closingStr={closingStr}
            onEditBalance={editBalance}
          />
          {modeA && (
            <TwoSidedStatement
              bankClosing={meta.closingBalance}
              cashbookClosing={cashbookMeta.closing}
              result={twoSided}
              itemCount={reconcileItems.length}
            />
          )}
          <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-card p-4 text-[12px] text-ink-2">
            <Stat label="Matched groups" value={matchGroups.length} />
            <Stat
              label="New (to post)"
              value={lines.filter((l) => !isMatched(l) && !!l.accountCode).length}
            />
            <Stat
              label="Unresolved"
              value={lines.filter((l) => !isResolved(l)).length}
            />
            <Stat label="Statement lines" value={lines.length} />
            {modeA && <Stat label="Cashbook lines" value={ledgerTxns.length} />}
          </div>
        </section>
      )}

      {/* ── Navigation / actions ── */}
      <section className="mt-8 border-t border-line pt-6">
        {posted ? (
          <div className="space-y-3">
            <p className="text-[12px] text-fmu-green">
              Posted to the ledger
              {postedBankName ? (
                <>
                  {" "}
                  against <span className="font-medium text-ink">{postedBankName}</span>
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
                  <Button size="sm" variant="outline" onClick={() => setReopening(false)}>
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
            {step !== "bank" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => goStep(prevStep(step))}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {step !== "report" ? (
              <Button
                size="sm"
                disabled={
                  step === "bank"
                    ? !canLeaveBank
                    : step === "ledger"
                      ? !canLeaveLedger
                      : false
                }
                onClick={() => goStep(nextStep(step))}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <>
                {editable && gateVariance !== null && !gateTied && (
                  <label className="flex w-full items-start gap-2 rounded-lg border border-fmu-yellow/40 bg-fmu-yellow/5 p-3 text-[12px] text-ink-2">
                    <input
                      type="checkbox"
                      aria-label="Acknowledge the reconciliation variance and post anyway"
                      checked={ackVariance}
                      onChange={(e) => setAckVariance(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      {modeA
                        ? "The bank and cashbook are off by "
                        : "This statement is off by "}
                      <span className="num">{fmtSigned(gateVariance)}</span>
                      {modeA
                        ? " after the unmatched items"
                        : ` (expected closing ${formatAmount(variance.expectedClosing!)}, stated ${formatAmount(variance.closing!)})`}
                      . I've reviewed it and want to post anyway.
                    </span>
                  </label>
                )}
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
                    {overCap
                      ? "Too many transactions (max 500) — split into monthly reconciliations"
                      : !bankAccountId
                        ? "Choose a bank account"
                        : !coverageReady
                          ? "Match or categorize every line to post"
                          : "Acknowledge the variance to post"}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function MatchGroupRow({
  group,
  lineByHash,
  candById,
  onUnmatch,
}: {
  group: MatchGroup;
  lineByHash: Map<string, StatementLine>;
  candById: Map<string, Candidate>;
  onUnmatch: () => void;
}) {
  const bankLines = group.bankRowHashes.map((h) => lineByHash.get(h)).filter(Boolean);
  const ledger = group.ledgerRefs.map((r) => candById.get(r)).filter(Boolean);
  const isSplit = group.bankRowHashes.length > 1 || group.ledgerRefs.length > 1;
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-[12px]">
      <span
        className={cn(
          "pill shrink-0",
          group.source === "ai"
            ? "pill--review"
            : group.source === "exact"
              ? "pill--balanced"
              : "pill--neutral",
        )}
      >
        {isSplit ? "split" : group.source === "ai" ? "AI" : group.source}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-ink">
          {bankLines.map((l) => l!.description).join(" + ") || "(bank lines)"}
        </div>
        <div className="num truncate text-[10px] text-ink-4">
          ↔ {ledger.map((c) => c!.description).join(" + ") || `${group.ledgerRefs.length} ledger entr${group.ledgerRefs.length === 1 ? "y" : "ies"}`}
          {group.reason ? ` · ${group.reason}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onUnmatch}
        aria-label="Unmatch"
        className="shrink-0 text-ink-4 hover:text-fmu-red"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TwoSidedStatement({
  bankClosing,
  cashbookClosing,
  result,
  itemCount,
}: {
  bankClosing: number | undefined;
  cashbookClosing: number | undefined;
  result: ReturnType<typeof reconcileToZero> | null;
  itemCount: number;
}) {
  const known = bankClosing != null && cashbookClosing != null;
  const tied = result ? Math.abs(result.residual) <= 0.02 : false;
  const cell = (label: string, content: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      <span className="num text-[13px] text-ink">{content}</span>
    </div>
  );
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card-tint/40 p-4">
      <div className="eyebrow">Bank vs cashbook</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {cell("Bank closing", bankClosing != null ? formatAmount(bankClosing) : "—")}
        {cell(
          "Cashbook closing",
          cashbookClosing != null ? formatAmount(cashbookClosing) : "—",
        )}
        {cell("Reconciling items", String(itemCount))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-[12px] text-ink-3">
          {!known
            ? "Enter both closing balances to tie out the two sides."
            : tied
              ? "The bank and cashbook reconcile after the unmatched items."
              : "The two sides don't tie out — review the unmatched items."}
        </span>
        <span
          className={cn(
            "pill",
            !known ? "pill--neutral" : tied ? "pill--balanced" : "pill--blocked",
          )}
        >
          {!known
            ? "No balances"
            : tied
              ? "Reconciled"
              : `Off by ${fmtSigned(result!.residual)}`}
        </span>
      </div>
    </section>
  );
}

function ReconStatement({
  meta,
  variance,
  editable,
  openingStr,
  closingStr,
  onEditBalance,
}: {
  meta: {
    sourceFormat?: "csv" | "pdf";
    bankName?: string;
    periodLabel?: string;
    statementCurrency?: string;
    openingBalance?: number;
    closingBalance?: number;
  };
  variance: ReturnType<typeof bankRecVariance>;
  editable: boolean;
  openingStr: string;
  closingStr: string;
  onEditBalance: (
    f: "openingBalance" | "closingBalance",
    raw: string,
    commit: boolean,
  ) => void;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-card-tint/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Reconciliation</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          {meta.sourceFormat === "pdf" && (
            <span className="inline-flex items-center gap-1 font-medium text-fmu-navy">
              <Sparkles className="h-3.5 w-3.5" /> AI-extracted
            </span>
          )}
          {meta.bankName && <span>{meta.bankName}</span>}
          {meta.periodLabel && <span>{meta.periodLabel}</span>}
          {meta.statementCurrency && <span className="num">{meta.statementCurrency}</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <BalanceField
          label="Opening balance"
          editable={editable}
          strValue={openingStr}
          numValue={meta.openingBalance}
          onChange={(v) => onEditBalance("openingBalance", v, false)}
          onCommit={(v) => onEditBalance("openingBalance", v, true)}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
            Movement
          </span>
          <span className="num text-[13px]">
            <span className="text-fmu-green">+{formatAmount(variance.inflows)}</span>{" "}
            <span className="text-fmu-red">−{formatAmount(variance.outflows)}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
            Expected closing
          </span>
          <span className="num text-[13px] text-ink">
            {variance.expectedClosing !== null
              ? formatAmount(variance.expectedClosing)
              : "—"}
          </span>
        </div>
        <BalanceField
          label="Stated closing"
          editable={editable}
          strValue={closingStr}
          numValue={meta.closingBalance}
          onChange={(v) => onEditBalance("closingBalance", v, false)}
          onCommit={(v) => onEditBalance("closingBalance", v, true)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-[12px] text-ink-3">
          {variance.variance === null
            ? "Enter opening & closing balances to check the statement ties out."
            : variance.tied
              ? "Opening + movement equals the stated closing balance."
              : "Opening + movement doesn't equal the stated closing — a line may be missing, duplicated, or mis-read."}
        </span>
        <span
          className={cn(
            "pill",
            variance.variance === null
              ? "pill--neutral"
              : variance.tied
                ? "pill--balanced"
                : "pill--blocked",
          )}
        >
          {variance.variance === null
            ? "No balances"
            : variance.tied
              ? `Reconciled · ${formatAmount(Math.abs(variance.variance))}`
              : `Off by ${fmtSigned(variance.variance)}`}
        </span>
      </div>
    </section>
  );
}

function LinesTable({
  lines,
  onRemove,
}: {
  lines: StatementLine[];
  onRemove: (rowHash: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line bg-card-tint/40 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
            <th className="w-28 px-3 py-2.5">Date</th>
            <th className="px-3 py-2.5">Description</th>
            <th className="w-28 px-3 py-2.5 text-right">Amount</th>
            <th className="w-10 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.rowHash} className="border-b border-line last:border-0">
              <td className="num px-3 py-1.5 text-ink-3">{formatDate(l.date)}</td>
              <td className="px-3 py-1.5 text-ink">{l.description}</td>
              <td
                className={cn(
                  "num px-3 py-1.5 text-right",
                  l.signedAmount < 0 ? "text-fmu-red" : "text-fmu-green",
                )}
              >
                {fmtSigned(l.signedAmount)}
              </td>
              <td className="px-3 py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => onRemove(l.rowHash)}
                  aria-label="Remove line"
                  className="text-ink-4 hover:text-fmu-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidatesTable({
  rows,
  claimed,
}: {
  rows: Candidate[];
  claimed: Set<string>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line bg-card-tint/40 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
            <th className="w-28 px-3 py-2.5">Date</th>
            <th className="px-3 py-2.5">Description</th>
            <th className="w-28 px-3 py-2.5 text-right">Amount</th>
            <th className="w-20 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c._id} className="border-b border-line last:border-0">
              <td className="num px-3 py-1.5 text-ink-3">{formatDate(c.date)}</td>
              <td className="px-3 py-1.5 text-ink">{c.description}</td>
              <td
                className={cn(
                  "num px-3 py-1.5 text-right",
                  c.signedAmount < 0 ? "text-fmu-red" : "text-fmu-green",
                )}
              >
                {fmtSigned(c.signedAmount)}
              </td>
              <td className="px-3 py-1.5 text-right">
                {claimed.has(c._id) && (
                  <span className="pill pill--balanced">matched</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceOption({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        active ? "border-fmu-navy bg-fmu-navy/5" : "border-line bg-card hover:bg-card-tint",
      )}
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span
          className={cn(
            "h-3.5 w-3.5 rounded-full border",
            active ? "border-fmu-navy bg-fmu-navy" : "border-line-2",
          )}
        />
        {title}
      </div>
      <p className="mt-1 text-[11px] text-ink-3">{desc}</p>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      <span className="num text-[15px] text-ink">{value}</span>
    </div>
  );
}

function BalanceField({
  label,
  strValue,
  numValue,
  editable,
  onChange,
  onCommit,
}: {
  label: string;
  strValue: string;
  numValue: number | undefined;
  editable: boolean;
  onChange: (raw: string) => void;
  onCommit: (raw: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      {editable ? (
        <input
          aria-label={label}
          inputMode="decimal"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          placeholder="—"
          className="num w-full rounded border border-line bg-card px-2 py-1 text-[13px] outline-none focus:border-fmu-navy"
        />
      ) : (
        <span className="num text-[13px] text-ink">
          {numValue !== undefined ? formatAmount(numValue) : "—"}
        </span>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
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
        aria-label={label}
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

// ── Pure helpers ───────────────────────────────────────────────────────

function fmtSigned(n: number): string {
  return `${n < 0 ? "−" : "+"}${formatAmount(Math.abs(n))}`;
}

/** Map a parsed/extracted statement line to a cashbook LedgerTxn (Mode A). */
function toLedgerTxn(l: StatementLine): LedgerTxn {
  return {
    id: l.rowHash,
    date: l.date,
    description: l.description,
    signedAmount: l.signedAmount,
  };
}

function prevStep(s: WizardStep): WizardStep {
  const i = STEPS.findIndex((x) => x.key === s);
  return STEPS[Math.max(0, i - 1)].key;
}

function nextStep(s: WizardStep): WizardStep {
  const i = STEPS.findIndex((x) => x.key === s);
  return STEPS[Math.min(STEPS.length - 1, i + 1)].key;
}

function contraName(
  banks: { _id: string; name: string }[] | undefined,
  bankAccountId: string,
): string {
  return (banks ?? []).find((b) => b._id === bankAccountId)?.name ?? "this account";
}
