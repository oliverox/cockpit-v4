import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Accounting module substrate.
 *
 * Stitched into the root schema by spread in convex/schema.ts:
 *   export default defineSchema({ ...coreTables, ...accountingTables })
 * There is no runtime auto-merge — it's a literal object spread.
 *
 * Conventions (v4):
 *   • Every table is dual-keyed: workspaceId + customerId.
 *   • All `accounting_`-prefixed to avoid collisions with core tables.
 *   • Indexes are withIndex-friendly; never filter() at query time.
 *
 * Phase 1: accounting_accounts + accounting_opening_balances (Chart of Accounts).
 * Phase 2: accounting_ledger_entries (the double-entry ledger).
 * Bank-rec, VAT and budget tables arrive in later phases.
 */

export const accountType = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("equity"),
  v.literal("revenue"),
  v.literal("expense"),
);

export const ledgerSourceType = v.union(
  v.literal("journal_entry"),
  v.literal("bank_statement"),
  v.literal("opening_balance"),
  v.literal("system"),
);

export const reconciliationStatus = v.union(
  v.literal("unreconciled"),
  v.literal("reconciled"),
);

export const accountingTables = {
  accounting_accounts: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    code: v.string(),
    name: v.string(),
    type: accountType,
    /** References a sibling account's code; missing parents render flat. */
    parentCode: v.optional(v.string()),
    currency: v.optional(v.string()),
  })
    .index("by_customer_and_code", ["customerId", "code"])
    .index("by_workspace_and_customer", ["workspaceId", "customerId"]),

  /**
   * Opening balances, kept in a dedicated table (v3 buried these in the
   * ledger as `sourceType:"opening_balance"` rows). The ledger proper
   * (accounting_ledger_entries) arrives in Phase 2 and is written only as a
   * task-approval side-effect — opening balances are config-like and editable
   * directly here.
   */
  accounting_opening_balances: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    accountCode: v.string(),
    debit: v.number(),
    credit: v.number(),
    asOf: v.number(),
  }).index("by_customer_and_account", ["customerId", "accountCode"]),

  /**
   * The double-entry ledger. Written ONLY by the approval engine
   * (convex/modules/accounting/finalize.ts) as a side-effect of approving a
   * task — never by a client mutation. `periodKey` ('YYYY-MM') powers cheap
   * time-bucketed analytics. The reconciliation + bank fields are unused in
   * Phase 2 but make the table bank-rec-ready for Phase 3 (bank-statement
   * upload feeding the ledger).
   */
  accounting_ledger_entries: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    date: v.number(),
    periodKey: v.string(),
    accountCode: v.string(),
    description: v.string(),
    debit: v.number(),
    credit: v.number(),
    sourceType: ledgerSourceType,
    /** Groups all lines posted together (the balanced-assertion unit). */
    batchId: v.string(),
    reference: v.optional(v.string()),
    postedByTaskId: v.optional(v.id("tasks")),
    postedBy: v.optional(v.id("users")),
    postedAt: v.number(),
    /** Phase 3: string until a bank_accounts table exists, then re-typed. */
    bankAccountId: v.optional(v.string()),
    reconciliationStatus: reconciliationStatus,
    reconciliationId: v.optional(v.string()),
  })
    .index("by_customer_and_period", ["customerId", "periodKey"])
    .index("by_customer_and_date", ["customerId", "date"])
    .index("by_customer_and_account", ["customerId", "accountCode"])
    .index("by_workspace_and_customer", ["workspaceId", "customerId"])
    .index("by_posted_task", ["postedByTaskId"])
    .index("by_batch", ["batchId"])
    .index("by_customer_and_recon", ["customerId", "reconciliationStatus"]),

  /**
   * A customer's bank accounts (Phase 3). `ledgerAccountCode` is the
   * chart-of-accounts code that is the balancing/contra leg for entries posted
   * from this account's statements.
   */
  accounting_bank_accounts: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    name: v.string(),
    bankName: v.optional(v.string()),
    accountNumberLast4: v.optional(v.string()),
    currency: v.optional(v.string()),
    ledgerAccountCode: v.string(),
    lastReconciledAt: v.optional(v.number()),
  })
    .index("by_customer_and_name", ["customerId", "name"])
    .index("by_workspace_and_customer", ["workspaceId", "customerId"]),

  /**
   * One posted bank-statement import — the reversible grouping/reversal unit
   * (analogue of a journal batch). The ledger rows it produced share
   * reconciliationId === this batch id.
   */
  accounting_bank_rec_batches: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    bankAccountId: v.string(),
    reconciliationId: v.string(),
    /** Hash of the uploaded statement — enforced against duplicate imports. */
    statementFileHash: v.optional(v.string()),
    /** Hash of the uploaded cashbook (Mode A) — also duplicate-guarded. */
    cashbookFileHash: v.optional(v.string()),
    periodStart: v.optional(v.number()),
    periodEnd: v.optional(v.number()),
    lineCount: v.number(),
    postedByTaskId: v.id("tasks"),
    postedBy: v.id("users"),
    postedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_reconciliation", ["reconciliationId"])
    .index("by_posted_task", ["postedByTaskId"]),

  /**
   * One row per ledger entry reconciled to bank-statement line(s). Records the
   * link for the audit trail; written ONLY by the bank-rec finalize handler,
   * reversed (deleted) on reopen. The matched ledger row's reconciledStatus
   * flip is tracked separately as an op:update side-effect so reopen restores
   * it.
   *
   * Splits (Milestone 1+): a logical match can span many lines/entries. We keep
   * exactly ONE row per ledger entry (so `by_ledger_entry` stays single-valued
   * and indexable — Convex can't index into arrays); the rows of one logical
   * match share `matchGroupId`, and the bank line(s) on the match's bank side
   * ride along as the non-indexed `statementLineRowHashes` snapshot.
   *
   * The new fields are optional through the widen→narrow migration; the legacy
   * 1:1 `statementLineRowHash` is dropped in the narrow step (Milestone 7).
   */
  accounting_reconciliation_matches: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    bankAccountId: v.string(),
    reconciliationId: v.string(),
    /** Groups the rows of one logical match (a split → several rows). */
    matchGroupId: v.optional(v.string()),
    /** Legacy 1:1 bank-line hash (Phase 3b). Superseded by the array below. */
    statementLineRowHash: v.optional(v.string()),
    /** The bank line(s) on this match's bank side — non-indexed snapshot. */
    statementLineRowHashes: v.optional(v.array(v.string())),
    ledgerEntryId: v.id("accounting_ledger_entries"),
    matchType: v.union(
      v.literal("exact"),
      v.literal("manual"),
      v.literal("probable"),
      v.literal("split"),
      v.literal("ai"),
    ),
    // Snapshot of the bank side (lines live only in task.payload).
    statementDate: v.number(),
    statementDescription: v.string(),
    statementAmount: v.number(),
    postedByTaskId: v.id("tasks"),
    postedBy: v.id("users"),
    postedAt: v.number(),
  })
    .index("by_reconciliation", ["reconciliationId"])
    .index("by_ledger_entry", ["ledgerEntryId"])
    .index("by_match_group", ["matchGroupId"])
    .index("by_customer", ["customerId"]),
};
