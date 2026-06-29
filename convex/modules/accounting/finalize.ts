import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { SideEffect } from "../../lib/approvalEngine";
import {
  type JournalEntryPayload,
  journalTotals,
  lineIsValid,
  round2,
} from "../../../modules/accounting/lib/journal-entry";
import { toPeriodKey } from "../../../modules/accounting/lib/period";
import {
  effectiveMatchGroups,
  type BankRecPayload,
  type LedgerTxn,
  type MatchGroup,
  type StatementLine,
} from "../../../modules/accounting/lib/bank-statement";
import { SUSPENSE_CODE } from "../../../modules/accounting/lib/default-coa";

/**
 * Post a balanced journal entry's draft lines to the ledger. A plain helper
 * (NOT a registered Convex function) invoked inline by the approval engine
 * within tasks.setStatus's transaction — if it throws, the whole approval
 * (including the status flip) rolls back, so the ledger never diverges from
 * task state.
 *
 * `accounting_ledger_entries` is ONLY ever written here. Returns the
 * create side-effects so the approval can be reversed on reopen.
 */
export async function postJournalEntryToLedger(
  ctx: MutationCtx,
  args: { task: Doc<"tasks">; approvedBy: Id<"users"> },
): Promise<SideEffect[]> {
  const { task, approvedBy } = args;
  const payload = (task.payload ?? {}) as JournalEntryPayload;
  const lines = payload.lines ?? [];

  // --- Server-authoritative balanced-batch assertion ---
  if (lines.length < 2) {
    throw new Error("A journal entry needs at least two lines.");
  }
  for (const l of lines) {
    if (!lineIsValid(l)) {
      throw new Error(
        "Each line must name an account and be exactly one of debit or credit.",
      );
    }
  }
  const totals = journalTotals(lines);
  if (!totals.balanced) {
    throw new Error(
      `Journal entry is not balanced: debits ${totals.debit} ≠ credits ${totals.credit}.`,
    );
  }

  // Every referenced account must exist for this customer.
  for (const l of lines) {
    const acct = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", task.customerId).eq("code", l.accountCode),
      )
      .first();
    if (!acct) throw new Error(`Account ${l.accountCode} does not exist.`);
  }

  const postedAt = Date.now();
  const date = payload.date ?? postedAt;
  const periodKey = toPeriodKey(date);
  const batchId = `je_${task._id}_${postedAt}`;

  const sideEffects: SideEffect[] = [];
  for (const l of lines) {
    const debit = round2(l.debit || 0);
    const credit = round2(l.credit || 0);
    const id = await ctx.db.insert("accounting_ledger_entries", {
      workspaceId: task.workspaceId,
      customerId: task.customerId,
      date,
      periodKey,
      accountCode: l.accountCode,
      description: l.description?.trim() || payload.memo?.trim() || task.title,
      debit,
      credit,
      sourceType: "journal_entry",
      batchId,
      reference: payload.reference?.trim() || undefined,
      postedByTaskId: task._id,
      postedBy: approvedBy,
      postedAt,
      reconciliationStatus: "unreconciled",
    });
    sideEffects.push({
      kind: "substrate",
      table: "accounting_ledger_entries",
      refId: id,
      op: "create",
      after: { accountCode: l.accountCode, debit, credit, periodKey, batchId },
    });
  }

  await ctx.db.insert("audit_log", {
    workspaceId: task.workspaceId,
    actorId: approvedBy,
    subjectKind: "substrate",
    subjectTable: "accounting_ledger_entries",
    subjectId: batchId,
    action: "create",
    after: {
      batchId,
      lines: lines.length,
      total: totals.debit,
      periodKey,
      postedByTaskId: task._id,
    },
  });

  return sideEffects;
}

// ── Bank reconciliation finalize ────────────────────────────────────────

/** A group's match-type label for the audit row (split takes precedence). */
function groupMatchType(
  g: MatchGroup,
): "exact" | "manual" | "probable" | "split" | "ai" {
  if (g.bankRowHashes.length > 1 || g.ledgerRefs.length > 1) return "split";
  if (g.source === "ai") {
    return g.confidence === "exact"
      ? "exact"
      : g.confidence === "probable"
        ? "probable"
        : "ai";
  }
  return g.source; // "exact" | "manual"
}

/** Assert every code exists for the customer (server authority — no prereqs). */
async function assertCodesExist(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  codes: Iterable<string>,
) {
  for (const code of new Set(codes)) {
    const acct = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", customerId).eq("code", code),
      )
      .first();
    if (!acct) throw new Error(`Account ${code} does not exist.`);
  }
}

/** Shared, resolved context handed to the per-mode posting helpers. */
type BankRecContext = {
  task: Doc<"tasks">;
  approvedBy: Id<"users">;
  payload: BankRecPayload;
  bankAccountId: string;
  contraCode: string;
  batchId: string;
  postedAt: number;
  sideEffects: SideEffect[];
  /** Insert one ledger leg + record its reversible create side-effect; returns
   *  the new row id. `reconciled` controls whether it's born reconciled. */
  insertLeg: (
    accountCode: string,
    debit: number,
    credit: number,
    line: { date: number; description: string },
    reconciled?: boolean,
  ) => Promise<Id<"accounting_ledger_entries">>;
};

/**
 * Post a reconciled bank statement to the ledger (Phase 3a–3d). Same contract as
 * postJournalEntryToLedger — inline within tasks.setStatus, transactional, fully
 * reversible. Branches on the ledger source:
 *  - Mode B (`existing`): reconcile the statement against the EXISTING Convex
 *    ledger — matched groups flip entries to reconciled; uncategorized "new"
 *    lines post a balanced contra/category pair.
 *  - Mode A (`cashbook`): IMPORT the uploaded cashbook as balanced pairs (born
 *    reconciled where matched to a statement line, else left unreconciled) and
 *    record the matches; bank-only statement lines post their own pair.
 */
export async function postBankStatementToLedger(
  ctx: MutationCtx,
  args: { task: Doc<"tasks">; approvedBy: Id<"users"> },
): Promise<SideEffect[]> {
  const { task, approvedBy } = args;
  const payload = (task.payload ?? {}) as BankRecPayload;
  const lines = (payload.lines ?? []).filter((l) => l.signedAmount !== 0);

  if (!payload.bankAccountId) throw new Error("Select a bank account first.");
  if (lines.length === 0) throw new Error("No statement lines to post.");

  const isModeA = payload.ledgerSource === "cashbook";
  const ledgerTxns = isModeA
    ? (payload.ledgerTxns ?? []).filter((t) => t.signedAmount !== 0)
    : [];
  // Bound the single transactional mutation — Mode A imports the whole cashbook
  // as ~2N ledger writes. Bank rec is monthly, so real statements are small.
  if (lines.length + ledgerTxns.length > 500) {
    throw new Error(
      "Too many transactions to post at once (max 500) — split into monthly reconciliations.",
    );
  }

  // coa_exists — server authority (no prereq engine yet).
  const anyAccount = await ctx.db
    .query("accounting_accounts")
    .withIndex("by_customer_and_code", (q) => q.eq("customerId", task.customerId))
    .take(1);
  if (anyAccount.length === 0) {
    throw new Error("Set up the chart of accounts before posting a statement.");
  }

  const bankAccount = await ctx.db.get(
    payload.bankAccountId as Id<"accounting_bank_accounts">,
  );
  if (!bankAccount || bankAccount.customerId !== task.customerId) {
    throw new Error("Bank account not found.");
  }
  const contraCode = bankAccount.ledgerAccountCode;

  // Duplicate-import guard: refuse a file already posted (an active batch with
  // the same content hash). Mode A has two files. Reversing a batch deletes its
  // row, so a re-import after reopen is allowed.
  const hashes = [
    payload.statementFileHash,
    isModeA ? payload.cashbookFileHash : undefined,
  ].filter((h): h is string => !!h);
  if (hashes.length > 0) {
    const existing = await ctx.db
      .query("accounting_bank_rec_batches")
      .withIndex("by_customer", (q) => q.eq("customerId", task.customerId))
      .collect();
    const used = new Set<string>();
    for (const b of existing) {
      if (b.statementFileHash) used.add(b.statementFileHash);
      if (b.cashbookFileHash) used.add(b.cashbookFileHash);
    }
    if (hashes.some((h) => used.has(h))) {
      throw new Error("This statement (or cashbook) has already been imported and posted.");
    }
  }

  const postedAt = Date.now();
  const batchId = `bankrec_${task._id}_${postedAt}`;
  const sideEffects: SideEffect[] = [];

  const insertLeg = async (
    accountCode: string,
    debit: number,
    credit: number,
    line: { date: number; description: string },
    reconciled = true,
  ): Promise<Id<"accounting_ledger_entries">> => {
    const id = await ctx.db.insert("accounting_ledger_entries", {
      workspaceId: task.workspaceId,
      customerId: task.customerId,
      date: line.date,
      periodKey: toPeriodKey(line.date),
      accountCode,
      description: line.description || task.title,
      debit,
      credit,
      sourceType: "bank_statement",
      batchId,
      postedByTaskId: task._id,
      postedBy: approvedBy,
      postedAt,
      bankAccountId: payload.bankAccountId,
      reconciliationStatus: reconciled ? "reconciled" : "unreconciled",
      reconciliationId: reconciled ? batchId : undefined,
    });
    sideEffects.push({
      kind: "substrate",
      table: "accounting_ledger_entries",
      refId: id,
      op: "create",
      after: { accountCode, debit, credit, batchId },
    });
    return id;
  };

  const c: BankRecContext = {
    task,
    approvedBy,
    payload,
    bankAccountId: payload.bankAccountId,
    contraCode,
    batchId,
    postedAt,
    sideEffects,
    insertLeg,
  };

  if (isModeA) {
    await postModeACashbook(ctx, c, lines, ledgerTxns);
  } else {
    await postModeBMatches(ctx, c, lines);
  }

  const allDates = [...lines.map((l) => l.date), ...ledgerTxns.map((t) => t.date)];
  const periodStart = Math.min(...allDates);
  const periodEnd = Math.max(...allDates);

  const batchRowId = await ctx.db.insert("accounting_bank_rec_batches", {
    workspaceId: task.workspaceId,
    customerId: task.customerId,
    bankAccountId: payload.bankAccountId,
    reconciliationId: batchId,
    statementFileHash: payload.statementFileHash,
    cashbookFileHash: isModeA ? payload.cashbookFileHash : undefined,
    periodStart,
    periodEnd,
    lineCount: lines.length + ledgerTxns.length,
    postedByTaskId: task._id,
    postedBy: approvedBy,
    postedAt,
  });
  sideEffects.push({
    kind: "substrate",
    table: "accounting_bank_rec_batches",
    refId: batchRowId,
    op: "create",
  });

  await ctx.db.insert("audit_log", {
    workspaceId: task.workspaceId,
    actorId: approvedBy,
    subjectKind: "substrate",
    subjectTable: "accounting_bank_rec_batches",
    subjectId: batchId,
    action: "create",
    after: {
      batchId,
      ledgerSource: payload.ledgerSource ?? "existing",
      lines: lines.length,
      cashbook: ledgerTxns.length,
      bankAccountId: payload.bankAccountId,
      postedByTaskId: task._id,
      // Reconciliation tie-out at post time — durable audit of a posted-with-
      // acknowledged-variance batch.
      varianceAtPost: payload.varianceAtPost,
      varianceAcknowledged: payload.varianceAcknowledged,
    },
  });

  return sideEffects;
}

/**
 * Mode B: reconcile against the existing Convex ledger. Matched groups flip the
 * referenced (unreconciled, contra-account) ledger entries to reconciled
 * (op:update, before-state captured) + one match row per entry; uncategorized
 * "new" statement lines post a balanced contra/category pair.
 */
async function postModeBMatches(
  ctx: MutationCtx,
  c: BankRecContext,
  lines: StatementLine[],
) {
  const { task, approvedBy, payload, contraCode, batchId, postedAt, sideEffects, insertLeg } = c;
  const groups = effectiveMatchGroups(payload);
  const lineByHash = new Map(lines.map((l) => [l.rowHash, l]));

  // A bank line is in at most one group; the rest are "new" and need a category.
  const matchedBankHashes = new Set<string>();
  for (const g of groups) {
    if (g.bankRowHashes.length === 0 || g.ledgerRefs.length === 0) {
      throw new Error("A match must have at least one statement line and one ledger entry.");
    }
    for (const h of g.bankRowHashes) {
      if (matchedBankHashes.has(h)) {
        throw new Error("A statement line appears in more than one match.");
      }
      matchedBankHashes.add(h);
      if (!lineByHash.has(h)) {
        throw new Error("A match references a statement line that no longer exists — reopen and re-match.");
      }
    }
  }
  const newLines = lines.filter((l) => !matchedBankHashes.has(l.rowHash));
  for (const l of newLines) {
    if (!l.accountCode) {
      throw new Error("Every new statement line must be categorized before posting.");
    }
  }

  await assertCodesExist(ctx, task.customerId, [
    contraCode,
    ...newLines.map((l) => l.accountCode!),
  ]);

  // Matched groups: flip every referenced ledger entry to reconciled. A group
  // may span several bank lines and/or ledger entries (a split); each ledger
  // entry is claimed by at most one group across the whole batch.
  const claimedLedger = new Set<string>();
  for (const g of groups) {
    const matchType = groupMatchType(g);
    const entries: Doc<"accounting_ledger_entries">[] = [];
    for (const ref of g.ledgerRefs) {
      if (claimedLedger.has(ref)) {
        throw new Error("Two matches claim the same ledger entry.");
      }
      claimedLedger.add(ref);
      const entry = await ctx.db.get(ref as Id<"accounting_ledger_entries">);
      if (!entry || entry.customerId !== task.customerId) {
        throw new Error("A matched ledger entry no longer exists.");
      }
      if (entry.reconciliationStatus !== "unreconciled") {
        throw new Error("A matched ledger entry is already reconciled — reopen and re-match.");
      }
      // Only entries on THIS bank's ledger code — guards against matching the
      // wrong leg of a journal entry.
      if (entry.accountCode !== contraCode) {
        throw new Error("A matched entry must be on the bank account's ledger account.");
      }
      entries.push(entry);
    }

    // Bank side and ledger side must net to the same signed amount (amount AND
    // direction agree), within tolerance — generalises the 1:1 check to splits.
    const bankSigned = round2(
      g.bankRowHashes.reduce(
        (s, h) => round2(s + (lineByHash.get(h)?.signedAmount ?? 0)),
        0,
      ),
    );
    const ledgerSigned = round2(
      entries.reduce((s, e) => round2(s + round2(e.debit - e.credit)), 0),
    );
    if (Math.abs(bankSigned - ledgerSigned) > 0.02) {
      throw new Error("A match's statement total doesn't equal its ledger total.");
    }

    const snap = groupSnapshot(g, lineByHash, task.title, postedAt);
    for (const entry of entries) {
      const before = {
        reconciliationStatus: entry.reconciliationStatus,
        // null (not undefined) so it survives serialization inside the
        // sideEffects array; reverseApproval translates null → undefined.
        reconciliationId: entry.reconciliationId ?? null,
      };
      await ctx.db.patch(entry._id, {
        reconciliationStatus: "reconciled",
        reconciliationId: batchId,
      });
      sideEffects.push({
        kind: "substrate",
        table: "accounting_ledger_entries",
        refId: entry._id,
        op: "update",
        before,
        after: { reconciliationStatus: "reconciled", reconciliationId: batchId },
      });
      const matchRowId = await ctx.db.insert("accounting_reconciliation_matches", {
        workspaceId: task.workspaceId,
        customerId: task.customerId,
        bankAccountId: c.bankAccountId,
        reconciliationId: batchId,
        matchGroupId: g.groupId,
        statementLineRowHashes: g.bankRowHashes,
        ledgerEntryId: entry._id,
        matchType,
        statementDate: snap.date,
        statementDescription: snap.description,
        statementAmount: bankSigned,
        postedByTaskId: task._id,
        postedBy: approvedBy,
        postedAt,
      });
      sideEffects.push({
        kind: "substrate",
        table: "accounting_reconciliation_matches",
        refId: matchRowId,
        op: "create",
      });
    }
  }

  // New lines: post a balanced bank-contra / category pair (the 3a flow).
  for (const l of newLines) {
    const amount = round2(Math.abs(l.signedAmount));
    const inflow = l.signedAmount > 0;
    await insertLeg(contraCode, inflow ? amount : 0, inflow ? 0 : amount, l);
    await insertLeg(l.accountCode!, inflow ? 0 : amount, inflow ? amount : 0, l);
  }
}

/**
 * Mode A: import the uploaded cashbook into the ledger, then reconcile the bank
 * statement against it. Each cashbook txn posts a balanced contra/category pair
 * (category = its assigned code, else Suspense); the contra leg is born
 * RECONCILED iff a statement line matches it (a single op:create — never
 * create-then-flip — so reversal is pure deletes). Cashbook-only txns import
 * unreconciled (outstanding items). Bank-only statement lines post their own
 * categorized pair.
 */
async function postModeACashbook(
  ctx: MutationCtx,
  c: BankRecContext,
  lines: StatementLine[],
  ledgerTxns: LedgerTxn[],
) {
  const { task, approvedBy, payload, contraCode, batchId, postedAt, sideEffects, insertLeg } = c;
  const groups = effectiveMatchGroups(payload);
  const lineByHash = new Map(lines.map((l) => [l.rowHash, l]));
  const txnById = new Map(ledgerTxns.map((t) => [t.id, t]));

  // Validate groups: bank hashes and cashbook refs each claimed once and real;
  // every group balances (bank signed total == cashbook signed total).
  const matchedBankHashes = new Set<string>();
  const matchedLedgerIds = new Set<string>();
  for (const g of groups) {
    if (g.bankRowHashes.length === 0 || g.ledgerRefs.length === 0) {
      throw new Error("A match must have at least one statement line and one cashbook entry.");
    }
    for (const h of g.bankRowHashes) {
      if (matchedBankHashes.has(h)) {
        throw new Error("A statement line appears in more than one match.");
      }
      matchedBankHashes.add(h);
      if (!lineByHash.has(h)) {
        throw new Error("A match references a statement line that no longer exists — reopen and re-match.");
      }
    }
    for (const ref of g.ledgerRefs) {
      if (matchedLedgerIds.has(ref)) {
        throw new Error("A cashbook entry appears in more than one match.");
      }
      matchedLedgerIds.add(ref);
      if (!txnById.has(ref)) {
        throw new Error("A match references a cashbook entry that no longer exists — reopen and re-match.");
      }
    }
    const bankSigned = round2(
      g.bankRowHashes.reduce((s, h) => round2(s + (lineByHash.get(h)?.signedAmount ?? 0)), 0),
    );
    const ledgerSigned = round2(
      g.ledgerRefs.reduce((s, r) => round2(s + (txnById.get(r)?.signedAmount ?? 0)), 0),
    );
    if (Math.abs(bankSigned - ledgerSigned) > 0.02) {
      throw new Error("A match's statement total doesn't equal its cashbook total.");
    }
  }

  const bankOnly = lines.filter((l) => !matchedBankHashes.has(l.rowHash));
  for (const l of bankOnly) {
    if (!l.accountCode) {
      throw new Error("Every bank-only statement line must be categorized before posting.");
    }
  }

  // Codes: contra + Suspense (if any uncategorized cashbook line) + every
  // assigned cashbook category + every bank-only category.
  const needsSuspense = ledgerTxns.some((t) => !t.accountCode);
  await assertCodesExist(ctx, task.customerId, [
    contraCode,
    ...(needsSuspense ? [SUSPENSE_CODE] : []),
    ...ledgerTxns
      .map((t) => t.accountCode)
      .filter((code): code is string => !!code),
    ...bankOnly.map((l) => l.accountCode!),
  ]);

  // Import each cashbook txn as a balanced pair; the contra leg is born
  // reconciled iff the txn is matched to a statement line.
  const importedContra = new Map<string, Id<"accounting_ledger_entries">>();
  for (const t of ledgerTxns) {
    const reconciled = matchedLedgerIds.has(t.id);
    const amount = round2(Math.abs(t.signedAmount));
    const inflow = t.signedAmount > 0;
    const category = t.accountCode || SUSPENSE_CODE;
    const line = { date: t.date, description: t.description };
    const contraId = await insertLeg(
      contraCode,
      inflow ? amount : 0,
      inflow ? 0 : amount,
      line,
      reconciled,
    );
    await insertLeg(category, inflow ? 0 : amount, inflow ? amount : 0, line, reconciled);
    importedContra.set(t.id, contraId);
  }

  // Match rows: link the bank line(s) to the imported contra leg of each
  // matched cashbook txn.
  for (const g of groups) {
    const matchType = groupMatchType(g);
    const snap = groupSnapshot(g, lineByHash, task.title, postedAt);
    const bankSigned = round2(
      g.bankRowHashes.reduce((s, h) => round2(s + (lineByHash.get(h)?.signedAmount ?? 0)), 0),
    );
    for (const ref of g.ledgerRefs) {
      const ledgerEntryId = importedContra.get(ref)!;
      const matchRowId = await ctx.db.insert("accounting_reconciliation_matches", {
        workspaceId: task.workspaceId,
        customerId: task.customerId,
        bankAccountId: c.bankAccountId,
        reconciliationId: batchId,
        matchGroupId: g.groupId,
        statementLineRowHashes: g.bankRowHashes,
        ledgerEntryId,
        matchType,
        statementDate: snap.date,
        statementDescription: snap.description,
        statementAmount: bankSigned,
        postedByTaskId: task._id,
        postedBy: approvedBy,
        postedAt,
      });
      sideEffects.push({
        kind: "substrate",
        table: "accounting_reconciliation_matches",
        refId: matchRowId,
        op: "create",
      });
    }
  }

  // Bank-only lines (on the statement, not the cashbook): post their own
  // balanced reconciled pair (a real transaction the cashbook missed).
  for (const l of bankOnly) {
    const amount = round2(Math.abs(l.signedAmount));
    const inflow = l.signedAmount > 0;
    await insertLeg(contraCode, inflow ? amount : 0, inflow ? 0 : amount, l, true);
    await insertLeg(l.accountCode!, inflow ? 0 : amount, inflow ? amount : 0, l, true);
  }
}

/** Bank-side snapshot (date + label) for a match group's audit rows. */
function groupSnapshot(
  g: MatchGroup,
  lineByHash: Map<string, StatementLine>,
  fallbackTitle: string,
  postedAt: number,
): { date: number; description: string } {
  const dates = g.bankRowHashes
    .map((h) => lineByHash.get(h)?.date)
    .filter((d): d is number => typeof d === "number");
  const first = lineByHash.get(g.bankRowHashes[0]);
  return {
    date: dates.length ? Math.min(...dates) : postedAt,
    description:
      (first?.description || fallbackTitle) +
      (g.bankRowHashes.length > 1 ? ` (+${g.bankRowHashes.length - 1} more)` : ""),
  };
}
