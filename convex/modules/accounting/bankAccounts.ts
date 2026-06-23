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

/**
 * Bank accounts for the Accounting module (Phase 3). Firm-only, dual-keyed,
 * audited — same conventions as accounts.ts. `ledgerAccountCode` is the
 * chart-of-accounts code used as the contra leg when a statement posts.
 */

async function assertCanWrite(
  ctx: MutationCtx,
  actor: Actor,
  customerId: Id<"customers">,
  workspaceId: Id<"workspaces">,
) {
  if (!canActInWorkspace(actor, workspaceId)) throw new Error("Not authorised");
  if (!(await canSeeCustomer(ctx, actor, customerId))) {
    throw new Error("Not authorised");
  }
}

export const listBankAccounts = query({
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
    return await ctx.db
      .query("accounting_bank_accounts")
      .withIndex("by_customer_and_name", (q) =>
        q.eq("customerId", args.customerId),
      )
      .collect();
  },
});

export const createBankAccount = mutation({
  args: {
    customerId: v.id("customers"),
    name: v.string(),
    ledgerAccountCode: v.string(),
    bankName: v.optional(v.string()),
    accountNumberLast4: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    await assertCanWrite(ctx, actor, args.customerId, customer.workspaceId);

    const name = args.name.trim();
    if (!name) throw new Error("Account name is required");

    // The contra ledger code must exist in the chart of accounts.
    const ledgerAccount = await ctx.db
      .query("accounting_accounts")
      .withIndex("by_customer_and_code", (q) =>
        q.eq("customerId", args.customerId).eq("code", args.ledgerAccountCode),
      )
      .first();
    if (!ledgerAccount) {
      throw new Error(
        `Ledger account ${args.ledgerAccountCode} does not exist in the chart of accounts.`,
      );
    }

    const id = await ctx.db.insert("accounting_bank_accounts", {
      workspaceId: customer.workspaceId,
      customerId: args.customerId,
      name,
      bankName: args.bankName?.trim() || undefined,
      accountNumberLast4: args.accountNumberLast4?.trim() || undefined,
      currency: args.currency?.trim() || "MUR",
      ledgerAccountCode: args.ledgerAccountCode,
    });

    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "substrate",
      subjectTable: "accounting_bank_accounts",
      subjectId: id,
      action: "create",
      after: { name, ledgerAccountCode: args.ledgerAccountCode },
      ...(isSuperadmin(actor)
        ? { superadminContext: { reason: actor.sessionReason } }
        : {}),
    });
    return id;
  },
});

export const updateBankAccount = mutation({
  args: {
    bankAccountId: v.id("accounting_bank_accounts"),
    name: v.optional(v.string()),
    ledgerAccountCode: v.optional(v.string()),
    bankName: v.optional(v.string()),
    accountNumberLast4: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const acct = await ctx.db.get(args.bankAccountId);
    if (!acct) throw new Error("Bank account not found");
    await assertCanWrite(ctx, actor, acct.customerId, acct.workspaceId);

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const n = args.name.trim();
      if (!n) throw new Error("Account name is required");
      patch.name = n;
    }
    if (args.ledgerAccountCode !== undefined) {
      const ledgerAccount = await ctx.db
        .query("accounting_accounts")
        .withIndex("by_customer_and_code", (q) =>
          q.eq("customerId", acct.customerId).eq("code", args.ledgerAccountCode!),
        )
        .first();
      if (!ledgerAccount) {
        throw new Error(
          `Ledger account ${args.ledgerAccountCode} does not exist.`,
        );
      }
      patch.ledgerAccountCode = args.ledgerAccountCode;
    }
    if (args.bankName !== undefined) patch.bankName = args.bankName.trim() || undefined;
    if (args.accountNumberLast4 !== undefined) {
      patch.accountNumberLast4 = args.accountNumberLast4.trim() || undefined;
    }
    if (args.currency !== undefined) patch.currency = args.currency.trim() || undefined;
    if (Object.keys(patch).length === 0) return;

    await ctx.db.patch(args.bankAccountId, patch);
    await ctx.db.insert("audit_log", {
      workspaceId: acct.workspaceId,
      actorId: actor.userId,
      subjectKind: "substrate",
      subjectTable: "accounting_bank_accounts",
      subjectId: args.bankAccountId,
      action: "update",
      after: patch,
      ...(isSuperadmin(actor)
        ? { superadminContext: { reason: actor.sessionReason } }
        : {}),
    });
  },
});
