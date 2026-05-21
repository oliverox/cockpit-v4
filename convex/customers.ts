import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  canActInWorkspace,
  canManageTeam,
  getActor,
  isClient,
  isMember,
  isSuperadmin,
} from "./lib/auth";
import { Id } from "./_generated/dataModel";

const customerMetadataValidator = v.object({
  brn: v.optional(v.string()),
  vatRegistration: v.optional(v.string()),
  primaryContactEmail: v.optional(v.string()),
  primaryContactPhone: v.optional(v.string()),
  timezone: v.optional(v.string()),
});

/** Resolve which workspace the caller is acting in (member or superadmin). */
function actorWorkspaceId(actor: Awaited<ReturnType<typeof getActor>>) {
  if (isMember(actor)) return actor.workspaceId;
  if (isSuperadmin(actor)) return actor.activeWorkspaceId ?? null;
  return null;
}

// -- Mutations ------------------------------------------------------------

/**
 * Create a customer in the caller's active workspace.
 * Members of the workspace (any role) may create customers.
 */
export const create = mutation({
  args: {
    name: v.string(),
    metadata: v.optional(customerMetadataValidator),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const workspaceId = actorWorkspaceId(actor);
    if (!workspaceId) {
      throw new Error("No active workspace");
    }

    const name = args.name.trim();
    if (!name) throw new Error("Customer name cannot be empty");
    if (name.length > 200) throw new Error("Customer name too long");

    const customerId = await ctx.db.insert("customers", {
      workspaceId,
      name,
      metadata: args.metadata,
    });

    await ctx.db.insert("audit_log", {
      workspaceId,
      actorId: actor.userId,
      subjectKind: "customer",
      subjectTable: "customers",
      subjectId: customerId,
      action: "create",
      after: { name, metadata: args.metadata },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return customerId;
  },
});

/**
 * Update a customer's name and/or metadata.
 * Members of the workspace may edit any customer in their scope.
 */
export const update = mutation({
  args: {
    customerId: v.id("customers"),
    name: v.optional(v.string()),
    metadata: v.optional(customerMetadataValidator),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No access to this customer");
    }

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Customer name cannot be empty");
      if (name.length > 200) throw new Error("Customer name too long");
      patch.name = name;
    }
    if (args.metadata !== undefined) patch.metadata = args.metadata;

    if (Object.keys(patch).length === 0) return args.customerId;

    const before = {
      name: customer.name,
      metadata: customer.metadata,
    };

    await ctx.db.patch(args.customerId, patch);

    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "customer",
      subjectTable: "customers",
      subjectId: args.customerId,
      action: "update",
      before,
      after: patch,
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.customerId;
  },
});

/**
 * Archive a customer (soft delete). Only owners/admins may archive.
 * The row stays in the table but is hidden from default lists.
 */
export const archive = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No access to this customer");
    }
    if (!canManageTeam(actor)) {
      throw new Error("Only admins can archive customers");
    }
    if (customer.archived) return args.customerId;

    await ctx.db.patch(args.customerId, { archived: true });

    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "customer",
      subjectTable: "customers",
      subjectId: args.customerId,
      action: "update",
      before: { archived: false },
      after: { archived: true },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.customerId;
  },
});

/** Reverse an archive. Same permissions as archive. */
export const unarchive = mutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No access to this customer");
    }
    if (!canManageTeam(actor)) {
      throw new Error("Only admins can unarchive customers");
    }
    if (!customer.archived) return args.customerId;

    await ctx.db.patch(args.customerId, { archived: false });

    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "customer",
      subjectTable: "customers",
      subjectId: args.customerId,
      action: "update",
      before: { archived: true },
      after: { archived: false },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.customerId;
  },
});

// -- Queries --------------------------------------------------------------

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
 * Excludes archived customers unless `includeArchived: true`.
 */
export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];

    const includeArchived = args.includeArchived === true;
    const visibleFilter = (c: { archived?: boolean }) =>
      includeArchived || !c.archived;

    // Resolve the workspace we're listing for: either via active session
    // (superadmin) or via membership (member).
    const session = await ctx.db
      .query("superadmin_sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (session && session.endedAt === undefined) {
      // Superadmin impersonating — return all customers in that workspace
      const all = await ctx.db
        .query("customers")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", session.activeWorkspaceId),
        )
        .take(500);
      return all.filter(visibleFilter);
    }

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
      return customers
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter(visibleFilter);
    }

    if (membership.scope === "all") {
      const all = await ctx.db
        .query("customers")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", membership.workspaceId),
        )
        .take(500);
      return all.filter(visibleFilter);
    }

    // assigned_only
    const assignments = await ctx.db
      .query("customer_assignments")
      .withIndex("by_workspace_and_user", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("userId", user._id),
      )
      .take(500);
    const customers = await Promise.all(
      assignments.map((a) => ctx.db.get(a.customerId)),
    );
    return customers
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .filter(visibleFilter);
  },
});
