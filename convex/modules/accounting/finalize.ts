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
import type { BankRecPayload } from "../../../modules/accounting/lib/bank-statement";

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

/**
 * Post a categorized bank statement to the ledger (Phase 3a). Same contract as
 * postJournalEntryToLedger — inline within tasks.setStatus, transactional. Each
 * statement line becomes a BALANCED double-entry pair: the bank account's
 * contra ledger code vs. the line's assigned category account, with the
 * debit/credit side set by the sign of the amount. The created rows + the batch
 * row are returned as reversible side-effects.
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

  // Partition (Phase 3b): matched lines flip an existing unreconciled ledger
  // entry to reconciled (no new posting); new lines post a balanced pair (3a).
  // Only NEW lines need a category.
  const matchByHash = new Map(
    (payload.matches ?? []).map((m) => [m.rowHash, m]),
  );
  const matchedLines = lines.filter((l) => matchByHash.has(l.rowHash));
  const newLines = lines.filter((l) => !matchByHash.has(l.rowHash));
  for (const l of newLines) {
    if (!l.accountCode) {
      throw new Error("Every new statement line must be categorized before posting.");
    }
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

  // Every referenced account (the contra + each category) must exist.
  const codes = new Set<string>([
    contraCode,
    ...newLines.map((l) => l.accountCode!),
  ]);
  for (const code of codes) {
    const acct = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", task.customerId).eq("code", code),
      )
      .first();
    if (!acct) throw new Error(`Account ${code} does not exist.`);
  }

  // Duplicate-import guard: refuse a statement already posted (an active batch
  // with the same content hash). Reversing a batch deletes its row, so a
  // re-import after reopen is allowed.
  if (payload.statementFileHash) {
    const existing = await ctx.db
      .query("accounting_bank_rec_batches")
      .withIndex("by_customer", (q) => q.eq("customerId", task.customerId))
      .collect();
    if (existing.some((b) => b.statementFileHash === payload.statementFileHash)) {
      throw new Error("This statement has already been imported and posted.");
    }
  }

  const postedAt = Date.now();
  const batchId = `bankrec_${task._id}_${postedAt}`;
  const dates = lines.map((l) => l.date);
  const periodStart = Math.min(...dates);
  const periodEnd = Math.max(...dates);
  const sideEffects: SideEffect[] = [];

  const insertLeg = async (
    accountCode: string,
    debit: number,
    credit: number,
    line: { date: number; description: string },
  ) => {
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
      reconciliationStatus: "reconciled",
      reconciliationId: batchId,
    });
    sideEffects.push({
      kind: "substrate",
      table: "accounting_ledger_entries",
      refId: id,
      op: "create",
      after: { accountCode, debit, credit, batchId },
    });
  };

  // Matched lines: flip the existing ledger entry to reconciled (op:update,
  // before-state captured for reversal) + record the match row.
  const claimed = new Set<string>();
  for (const l of matchedLines) {
    const m = matchByHash.get(l.rowHash)!;
    if (claimed.has(m.ledgerEntryId)) {
      throw new Error("Two statement lines are matched to the same ledger entry.");
    }
    claimed.add(m.ledgerEntryId);
    const entry = await ctx.db.get(
      m.ledgerEntryId as Id<"accounting_ledger_entries">,
    );
    if (!entry || entry.customerId !== task.customerId) {
      throw new Error("A matched ledger entry no longer exists.");
    }
    if (entry.reconciliationStatus !== "unreconciled") {
      throw new Error(
        "A matched ledger entry is already reconciled — reopen and re-match.",
      );
    }
    // A statement line can only reconcile against an entry on THIS bank
    // account's ledger code, with a matching signed amount (debit−credit,
    // so amount AND direction must agree). Guards against matching the wrong
    // leg of a journal entry or a receipt against an equal-magnitude payment.
    if (entry.accountCode !== contraCode) {
      throw new Error(
        "A matched entry must be on the bank account's ledger account.",
      );
    }
    const entrySigned = round2(entry.debit - entry.credit);
    if (Math.abs(entrySigned - round2(l.signedAmount)) > 0.02) {
      throw new Error(
        "A matched entry's amount/direction doesn't match the statement line.",
      );
    }
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
      bankAccountId: payload.bankAccountId,
      reconciliationId: batchId,
      statementLineRowHash: l.rowHash,
      ledgerEntryId: entry._id,
      matchType: m.matchType,
      statementDate: l.date,
      statementDescription: l.description || task.title,
      statementAmount: l.signedAmount,
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

  // New lines: post a balanced bank-contra / category pair (the 3a flow).
  for (const l of newLines) {
    const amount = round2(Math.abs(l.signedAmount));
    const inflow = l.signedAmount > 0;
    // Bank (contra) leg: inflow debits the asset, outflow credits it.
    await insertLeg(contraCode, inflow ? amount : 0, inflow ? 0 : amount, l);
    // Category leg: the opposite side.
    await insertLeg(l.accountCode!, inflow ? 0 : amount, inflow ? amount : 0, l);
  }

  const batchRowId = await ctx.db.insert("accounting_bank_rec_batches", {
    workspaceId: task.workspaceId,
    customerId: task.customerId,
    bankAccountId: payload.bankAccountId,
    reconciliationId: batchId,
    statementFileHash: payload.statementFileHash,
    periodStart,
    periodEnd,
    lineCount: lines.length,
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
      lines: lines.length,
      bankAccountId: payload.bankAccountId,
      postedByTaskId: task._id,
      // Reconciliation tie-out at post time (Phase 3c-ii) — durable audit of a
      // posted-with-acknowledged-variance batch.
      varianceAtPost: payload.varianceAtPost,
      varianceAcknowledged: payload.varianceAcknowledged,
    },
  });

  return sideEffects;
}
