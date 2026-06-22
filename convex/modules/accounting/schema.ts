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
 * Phase 1 ships the Chart of Accounts substrate only:
 *   accounting_accounts + accounting_opening_balances.
 * Ledger, bank-rec, VAT and budget tables arrive in later phases.
 */

export const accountType = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("equity"),
  v.literal("revenue"),
  v.literal("expense"),
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
};
