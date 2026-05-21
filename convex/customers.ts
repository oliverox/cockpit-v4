import { query } from "./_generated/server";
import { v } from "convex/values";
import { getActor, isMember, isClient } from "./lib/auth";

/**
 * Fetch a single customer the actor is allowed to see.
 * Returns null if the customer doesn't exist or the actor lacks access.
 */
export const get = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;

    if (isClient(actor)) {
      const ok = actor.customerAccess.some(
        (a) => a.customerId === args.customerId,
      );
      return ok ? customer : null;
    }

    if (isMember(actor)) {
      if (customer.workspaceId !== actor.workspaceId) return null;
      if (actor.scope === "all") return customer;
      const assignment = await ctx.db
        .query("customer_assignments")
        .withIndex("by_workspace_and_user", (q) =>
          q.eq("workspaceId", actor.workspaceId).eq("userId", actor.userId),
        )
        .filter((q) => q.eq(q.field("customerId"), args.customerId))
        .first();
      return assignment ? customer : null;
    }

    return null;
  },
});

/**
 * List customers visible to the current actor.
 * For Phase 0 this returns an empty array gracefully when there's no actor.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!membership || membership.archived) {
      // Maybe they're a client?
      const accesses = await ctx.db
        .query("customer_access")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(100);

      const customers = await Promise.all(
        accesses.map((a) => ctx.db.get(a.customerId)),
      );
      return customers.filter((c): c is NonNullable<typeof c> => c !== null);
    }

    if (membership.scope === "all") {
      return await ctx.db
        .query("customers")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", membership.workspaceId),
        )
        .take(500);
    }

    // assigned_only
    const assignments = await ctx.db
      .query("customer_assignments")
      .withIndex("by_workspace_and_user", (q) =>
        q
          .eq("workspaceId", membership.workspaceId)
          .eq("userId", user._id),
      )
      .take(500);

    const customers = await Promise.all(
      assignments.map((a) => ctx.db.get(a.customerId)),
    );
    return customers.filter((c): c is NonNullable<typeof c> => c !== null);
  },
});
