import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  getActor,
  tryGetActor,
  canActInWorkspace,
  canSeeCustomer,
  isClient,
  isSuperadmin,
  type Actor,
} from "../../lib/auth";
import { accountType } from "./schema";
import { DEFAULT_COA } from "../../../modules/accounting/lib/default-coa";

/**
 * Chart of Accounts CRUD for the Accounting module (Phase 1).
 *
 * The chart of accounts is FIRM-ONLY data — clients never see or edit it.
 * `canSeeCustomer` is a read gate that returns true for portal clients, so it
 * is NOT sufficient on its own: every op also requires the actor to be able to
 * act in the workspace (`canActInWorkspace` → members/superadmins only, never
 * clients), matching the convention in convex/tasks.ts and convex/documents.ts.
 *
 * Other v4 conventions: dual-key (workspaceId + customerId) on every row,
 * withIndex (never filter()), and an audit_log entry on every mutation.
 * The ledger doesn't exist yet, so deleting an account only clears its opening
 * balance — the transaction-aware cascade lands with the ledger in Phase 2.
 */

/**
 * Firm-only write gate for a customer's accounting data. Rejects clients
 * (canActInWorkspace is false for them) and enforces member assignment scope
 * (canSeeCustomer). Source `workspaceId` from the fetched doc, never the client.
 */
async function assertCanWrite(
  ctx: MutationCtx,
  actor: Actor,
  customerId: Id<"customers">,
  workspaceId: Id<"workspaces">,
) {
  if (!canActInWorkspace(actor, workspaceId)) {
    throw new Error("Not authorised");
  }
  if (!(await canSeeCustomer(ctx, actor, customerId))) {
    throw new Error("Not authorised");
  }
}

async function logAccountAudit(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    actor: Actor;
    subjectId: string;
    action: "create" | "update" | "delete";
    before?: unknown;
    after?: unknown;
  },
) {
  await ctx.db.insert("audit_log", {
    workspaceId: args.workspaceId,
    actorId: args.actor.userId,
    subjectKind: "substrate",
    subjectTable: "accounting_accounts",
    subjectId: args.subjectId,
    action: args.action,
    before: args.before,
    after: args.after,
    ...(isSuperadmin(args.actor)
      ? { superadminContext: { reason: args.actor.sessionReason } }
      : {}),
  });
}

// ── Queries (firm-only: members/superadmins, not clients) ────────────

export const listAccounts = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (
      !actor ||
      isClient(actor) ||
      !(await canSeeCustomer(ctx, actor, args.customerId))
    ) {
      return [];
    }
    const accounts = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();
    return accounts.sort((a, b) => a.code.localeCompare(b.code));
  },
});

export const getOpeningBalances = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (
      !actor ||
      isClient(actor) ||
      !(await canSeeCustomer(ctx, actor, args.customerId))
    ) {
      return {};
    }
    const rows = await ctx.db
      .query("accounting_opening_balances")
      .withIndex("by_customer_and_account", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();

    const map: Record<string, { debit: number; credit: number }> = {};
    for (const r of rows) {
      map[r.accountCode] = { debit: r.debit, credit: r.credit };
    }
    return map;
  },
});

export const getCoaHealth = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (
      !actor ||
      isClient(actor) ||
      !(await canSeeCustomer(ctx, actor, args.customerId))
    ) {
      return { totalAccounts: 0, placeholderCount: 0, isHealthy: true };
    }
    const accounts = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();

    const totalAccounts = accounts.length;
    const placeholderCount = accounts.filter((a) => a.name === a.code).length;
    const isHealthy =
      totalAccounts === 0 || placeholderCount / totalAccounts <= 0.3;
    return { totalAccounts, placeholderCount, isHealthy };
  },
});

// ── Mutations (firm-only) ────────────────────────────────────────────

export const createAccount = mutation({
  args: {
    customerId: v.id("customers"),
    code: v.string(),
    name: v.string(),
    type: accountType,
    parentCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    await assertCanWrite(ctx, actor, args.customerId, customer.workspaceId);

    const code = args.code.trim();
    const name = args.name.trim();
    if (!code) throw new Error("Account code is required");
    if (!name) throw new Error("Account name is required");

    const existing = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", args.customerId).eq("code", code),
      )
      .first();
    if (existing) {
      throw new Error(`Account with code "${code}" already exists`);
    }

    const id = await ctx.db.insert("accounting_accounts", {
      workspaceId: customer.workspaceId,
      customerId: args.customerId,
      code,
      name,
      type: args.type,
      parentCode: args.parentCode || undefined,
    });

    await logAccountAudit(ctx, {
      workspaceId: customer.workspaceId,
      actor,
      subjectId: id,
      action: "create",
      after: { code, name, type: args.type, parentCode: args.parentCode },
    });
    return id;
  },
});

export const updateAccount = mutation({
  args: {
    accountId: v.id("accounting_accounts"),
    name: v.optional(v.string()),
    type: v.optional(accountType),
    parentCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error("Account not found");
    await assertCanWrite(ctx, actor, account.customerId, account.workspaceId);

    const patch: {
      name?: string;
      type?: typeof account.type;
      parentCode?: string | undefined;
    } = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.type !== undefined) patch.type = args.type;
    if (args.parentCode !== undefined) {
      patch.parentCode = args.parentCode || undefined;
    }
    if (Object.keys(patch).length === 0) return;

    await ctx.db.patch(args.accountId, patch);

    await logAccountAudit(ctx, {
      workspaceId: account.workspaceId,
      actor,
      subjectId: args.accountId,
      action: "update",
      before: {
        name: account.name,
        type: account.type,
        parentCode: account.parentCode,
      },
      after: patch,
    });
  },
});

export const deleteAccount = mutation({
  args: { accountId: v.id("accounting_accounts") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error("Account not found");
    await assertCanWrite(ctx, actor, account.customerId, account.workspaceId);

    // Remove the account's opening balance, if any.
    const obRows = await ctx.db
      .query("accounting_opening_balances")
      .withIndex("by_customer_and_account", (q) =>
        q.eq("customerId", account.customerId).eq("accountCode", account.code),
      )
      .collect();
    for (const ob of obRows) await ctx.db.delete(ob._id);

    await ctx.db.delete(args.accountId);

    await logAccountAudit(ctx, {
      workspaceId: account.workspaceId,
      actor,
      subjectId: args.accountId,
      action: "delete",
      before: { code: account.code, name: account.name, type: account.type },
    });
  },
});

export const upsertOpeningBalance = mutation({
  args: {
    customerId: v.id("customers"),
    accountCode: v.string(),
    debit: v.number(),
    credit: v.number(),
    asOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    await assertCanWrite(ctx, actor, args.customerId, customer.workspaceId);

    const existing = await ctx.db
      .query("accounting_opening_balances")
      .withIndex("by_customer_and_account", (q) =>
        q.eq("customerId", args.customerId).eq("accountCode", args.accountCode),
      )
      .first();

    // Both zero → clear the opening balance.
    if (args.debit === 0 && args.credit === 0) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }

    // Default to the start of the current year (matches v3).
    const asOf =
      args.asOf ?? new Date(new Date().getFullYear(), 0, 1).getTime();

    if (existing) {
      await ctx.db.patch(existing._id, {
        debit: args.debit,
        credit: args.credit,
        asOf,
      });
    } else {
      await ctx.db.insert("accounting_opening_balances", {
        workspaceId: customer.workspaceId,
        customerId: args.customerId,
        accountCode: args.accountCode,
        debit: args.debit,
        credit: args.credit,
        asOf,
      });
    }
  },
});

/**
 * Seed the default Mauritius chart of accounts for a customer. Insert-only:
 * existing codes are left untouched, so re-running never clobbers a user's
 * edits (name/type/parentCode) — it only tops up missing accounts.
 */
export const importDefaultCoa = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    await assertCanWrite(ctx, actor, args.customerId, customer.workspaceId);

    const existing = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();
    const existingCodes = new Set(existing.map((a) => a.code));

    let created = 0;
    let skipped = 0;
    for (const a of DEFAULT_COA) {
      if (existingCodes.has(a.code)) {
        skipped++;
        continue;
      }
      await ctx.db.insert("accounting_accounts", {
        workspaceId: customer.workspaceId,
        customerId: args.customerId,
        code: a.code,
        name: a.name,
        type: a.type,
        parentCode: a.parentCode,
      });
      created++;
    }

    // Bulk seed is a customer-scoped event — keep subjectId consistent with
    // its declared table (avoids polluting accounting_accounts' by_subject).
    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "customer",
      subjectTable: "customers",
      subjectId: args.customerId,
      action: "update",
      after: { importedDefaultCoa: DEFAULT_COA.length, created, skipped },
      ...(isSuperadmin(actor)
        ? { superadminContext: { reason: actor.sessionReason } }
        : {}),
    });
    return { created, skipped };
  },
});
