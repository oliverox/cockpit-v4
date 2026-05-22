import { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  canActInWorkspace,
  canSeeCustomer,
  getActor,
  isClient,
  tryGetActor,
} from "./lib/auth";

/**
 * Internal: get-or-create the firm-internal thread for a customer.
 * Does NOT perform authorization — caller must verify access. Shared by
 * `tasks.create` (auto-card) and `ensureCustomerInternalThread`.
 */
export async function getOrCreateFirmThread(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  workspaceId: Id<"workspaces">,
  createdBy: Id<"users">,
): Promise<Id<"threads">> {
  const existing = await ctx.db
    .query("threads")
    .withIndex("by_customer_and_audience", (q) =>
      q.eq("customerId", customerId).eq("audience", "firm"),
    )
    .first();
  if (existing) return existing._id;

  return await ctx.db.insert("threads", {
    workspaceId,
    scope: "customer",
    customerId,
    audience: "firm",
    createdBy,
  });
}

/** Internal: get-or-create the shared (firm + client) thread for a customer. */
export async function getOrCreateClientSharedThread(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  workspaceId: Id<"workspaces">,
  createdBy: Id<"users">,
): Promise<Id<"threads">> {
  const existing = await ctx.db
    .query("threads")
    .withIndex("by_customer_and_audience", (q) =>
      q.eq("customerId", customerId).eq("audience", "client"),
    )
    .first();
  if (existing) return existing._id;

  return await ctx.db.insert("threads", {
    workspaceId,
    scope: "customer",
    customerId,
    audience: "client",
    createdBy,
  });
}

/**
 * Threads — conversation surfaces.
 *
 * Phase 1.4 ships only the per-customer internal thread (audience: "firm").
 * Client thread, team DMs, and channels come later — same table, more fields.
 *
 * Membership: for customer-scoped threads we derive access from `canSeeCustomer`,
 * not from explicit `thread_members` rows. Team threads (later) will need
 * explicit membership.
 */

/**
 * Idempotent — get-or-create the firm-internal thread for a customer.
 */
export const ensureCustomerInternalThread = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (isClient(actor)) {
      throw new Error("Clients can't access internal threads");
    }
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) {
      throw new Error("No access to this customer");
    }
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No active workspace");
    }

    return await getOrCreateFirmThread(
      ctx,
      args.customerId,
      customer.workspaceId,
      actor.userId,
    );
  },
});

/** Idempotent — get-or-create the shared client thread for a customer. */
export const ensureCustomerSharedThread = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) {
      throw new Error("No access to this customer");
    }
    // Members must be in the workspace; clients are gated by canSeeCustomer above.
    if (!isClient(actor) && !canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No active workspace");
    }
    return await getOrCreateClientSharedThread(
      ctx,
      args.customerId,
      customer.workspaceId,
      actor.userId,
    );
  },
});

/** Fetch a thread by id (used by the chat page after ensure). */
export const get = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return null;
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return null;

    if (thread.customerId) {
      if (!(await canSeeCustomer(ctx, actor, thread.customerId))) return null;
      if (isClient(actor) && thread.audience !== "client") return null;
    }
    return thread;
  },
});
