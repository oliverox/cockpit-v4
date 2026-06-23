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
