import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  canActInWorkspace,
  canSeeCustomer,
  getActor,
  isClient,
  tryGetActor,
} from "./lib/auth";

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

    const existing = await ctx.db
      .query("threads")
      .withIndex("by_customer_and_audience", (q) =>
        q.eq("customerId", args.customerId).eq("audience", "firm"),
      )
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("threads", {
      workspaceId: customer.workspaceId,
      scope: "customer",
      customerId: args.customerId,
      audience: "firm",
      createdBy: actor.userId,
    });
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
