import { v } from "convex/values";
import { query, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { tryGetActor, canSeeCustomer, isClient } from "../../lib/auth";
import { round2 } from "../../../modules/accounting/lib/journal-entry";
import {
  buildMonthBuckets,
  windowEnd,
  windowStart,
} from "../../../modules/accounting/lib/period";

/**
 * Ledger read model — trial balance, transactions, and the income-vs-expense
 * (P&L) time series. Firm-only (the ledger is internal): every query rejects
 * clients and gates on canSeeCustomer; withIndex throughout (never filter());
 * workspaceId is never trusted from the client.
 *
 * The ledger is read-only here — it is written only by the approval engine
 * (convex/modules/accounting/finalize.ts).
 */

/** Firm-only read gate. Returns the resolved actor, or null if denied. */
async function gateRead(ctx: QueryCtx, customerId: Id<"customers">) {
  const actor = await tryGetActor(ctx);
  if (!actor || isClient(actor)) return null;
  if (!(await canSeeCustomer(ctx, actor, customerId))) return null;
  return actor;
}

/** code → {name, type} for a customer, via one indexed scan. */
async function loadAccountIndex(ctx: QueryCtx, customerId: Id<"customers">) {
  const accounts = await ctx.db
    .query("accounting_accounts")
    .withIndex("by_customer_and_code", (q) => q.eq("customerId", customerId))
    .collect();
  return new Map(accounts.map((a) => [a.code, { name: a.name, type: a.type }]));
}

export const listTransactions = query({
  args: {
    customerId: v.id("customers"),
    periodKey: v.optional(v.string()),
    accountCode: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await gateRead(ctx, args.customerId))) return [];
    const names = await loadAccountIndex(ctx, args.customerId);
    const cap = args.limit ?? 200;

    let rows;
    if (args.accountCode) {
      rows = await ctx.db
        .query("accounting_ledger_entries")
        .withIndex("by_customer_and_account", (q) =>
          q
            .eq("customerId", args.customerId)
            .eq("accountCode", args.accountCode!),
        )
        .order("desc")
        .take(1000);
    } else if (args.periodKey) {
      rows = await ctx.db
        .query("accounting_ledger_entries")
        .withIndex("by_customer_and_period", (q) =>
          q.eq("customerId", args.customerId).eq("periodKey", args.periodKey!),
        )
        .order("desc")
        .take(1000);
    } else {
      rows = await ctx.db
        .query("accounting_ledger_entries")
        .withIndex("by_customer_and_date", (q) =>
          q.eq("customerId", args.customerId),
        )
        .order("desc")
        .take(cap);
    }

    return rows
      .sort((a, b) => b.date - a.date)
      .slice(0, cap)
      .map((e) => ({
        _id: e._id,
        date: e.date,
        periodKey: e.periodKey,
        accountCode: e.accountCode,
        accountName: names.get(e.accountCode)?.name ?? e.accountCode,
        description: e.description,
        debit: e.debit,
        credit: e.credit,
        reference: e.reference,
        batchId: e.batchId,
        sourceType: e.sourceType,
        reconciliationStatus: e.reconciliationStatus,
        postedByTaskId: e.postedByTaskId,
      }));
  },
});

export const getTrialBalance = query({
  args: { customerId: v.id("customers"), asOfDate: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!(await gateRead(ctx, args.customerId))) {
      return { rows: [], totalDebit: 0, totalCredit: 0 };
    }
    const asOf = args.asOfDate ?? Date.now();
    const accounts = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();

    const balance: Record<string, { debit: number; credit: number }> = {};
    for (const a of accounts) balance[a.code] = { debit: 0, credit: 0 };

    // Opening balances are the starting position (v4 keeps them in their own
    // table; fold them into the trial balance).
    const openings = await ctx.db
      .query("accounting_opening_balances")
      .withIndex("by_customer_and_account", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();
    for (const o of openings) {
      const b = (balance[o.accountCode] ??= { debit: 0, credit: 0 });
      b.debit += o.debit;
      b.credit += o.credit;
    }

    // Ledger movements up to the as-of date (indexed range, no filter()).
    const entries = await ctx.db
      .query("accounting_ledger_entries")
      .withIndex("by_customer_and_date", (q) =>
        q.eq("customerId", args.customerId).lte("date", asOf),
      )
      .collect();
    for (const e of entries) {
      const b = (balance[e.accountCode] ??= { debit: 0, credit: 0 });
      b.debit += e.debit;
      b.credit += e.credit;
    }

    // Build rows from the UNION of chart-of-accounts codes and codes that have
    // movement — so a ledger entry whose account was later deleted stays
    // visible (as 'unmapped') and the totals still reconcile.
    const meta = new Map(
      accounts.map((a) => [a.code, { name: a.name, type: a.type as string }]),
    );
    const rows = Object.keys(balance)
      .map((code) => ({
        code,
        name: meta.get(code)?.name ?? code,
        type: meta.get(code)?.type ?? "unmapped",
        debit: round2(balance[code].debit),
        credit: round2(balance[code].credit),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
    return { rows, totalDebit, totalCredit };
  },
});

/**
 * Income-vs-expense (P&L) monthly series over `months` months. Distinct from
 * cash flow: this groups REVENUE and EXPENSE accounts by month and account
 * TYPE (not bank movement). Revenue and expense are normalised positive;
 * netIncome = revenue − expense. Opening balances are excluded (balance-sheet,
 * not period flow).
 */
export const getIncomeExpenseSeries = query({
  args: { customerId: v.id("customers"), months: v.number() },
  handler: async (ctx, args) => {
    if (!(await gateRead(ctx, args.customerId))) return [];
    const months = Math.max(1, Math.min(36, Math.floor(args.months)));
    const now = Date.now();
    const buckets = buildMonthBuckets(months, now);
    const start = windowStart(months, now);
    const end = windowEnd(now);

    const types = await loadAccountIndex(ctx, args.customerId);

    const acc: Record<string, { revenue: number; expense: number }> = {};
    for (const b of buckets) acc[b.periodKey] = { revenue: 0, expense: 0 };

    // Bounded both sides — only entries inside the window are read.
    const entries = await ctx.db
      .query("accounting_ledger_entries")
      .withIndex("by_customer_and_date", (q) =>
        q.eq("customerId", args.customerId).gte("date", start).lt("date", end),
      )
      .collect();

    for (const e of entries) {
      const bucket = acc[e.periodKey];
      if (!bucket) continue;
      const type = types.get(e.accountCode)?.type;
      if (type === "revenue") bucket.revenue += e.credit - e.debit;
      else if (type === "expense") bucket.expense += e.debit - e.credit;
    }

    return buckets.map((b) => {
      const revenue = round2(acc[b.periodKey].revenue);
      const expense = round2(acc[b.periodKey].expense);
      return {
        periodKey: b.periodKey,
        year: b.year,
        month: b.month,
        label: b.label,
        revenue,
        expense,
        netIncome: round2(revenue - expense),
      };
    });
  },
});

/**
 * Unreconciled ledger entries — candidates a bank-statement line can match
 * against (Phase 3b). Scoped by customer + reconciliationStatus only (not by
 * bank account), because the usual match target is a manually-booked journal
 * entry, which carries no bankAccountId. Firm-only.
 */
export const getUnreconciledEntries = query({
  args: {
    customerId: v.id("customers"),
    /** Scope candidates to one ledger account (the bank's contra code). */
    accountCode: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await gateRead(ctx, args.customerId))) return [];
    const names = await loadAccountIndex(ctx, args.customerId);

    let rows;
    if (args.accountCode) {
      // Entries on the bank's contra account (the only valid match targets).
      const all = await ctx.db
        .query("accounting_ledger_entries")
        .withIndex("by_customer_and_account", (q) =>
          q.eq("customerId", args.customerId).eq("accountCode", args.accountCode!),
        )
        .take(args.limit ?? 1000);
      rows = all.filter((e) => e.reconciliationStatus === "unreconciled");
    } else {
      rows = await ctx.db
        .query("accounting_ledger_entries")
        .withIndex("by_customer_and_recon", (q) =>
          q
            .eq("customerId", args.customerId)
            .eq("reconciliationStatus", "unreconciled"),
        )
        .order("desc")
        .take(args.limit ?? 500);
    }

    return rows
      .sort((a, b) => b.date - a.date)
      .map((e) => ({
        _id: e._id,
        date: e.date,
        description: e.description,
        accountCode: e.accountCode,
        accountName: names.get(e.accountCode)?.name ?? e.accountCode,
        // Signed bank effect: debit increases the asset (inflow), credit
        // decreases it (outflow) — matches a statement line's signedAmount.
        signedAmount: round2(e.debit - e.credit),
        sourceType: e.sourceType,
      }));
  },
});
