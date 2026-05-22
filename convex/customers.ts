import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  canActInWorkspace,
  canManageTeam,
  canSeeCustomer,
  getActor,
  isMember,
  isSuperadmin,
  tryGetActor,
} from "./lib/auth";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

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
      throw new Error("Only the firm owner can archive customers");
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
      throw new Error("Only the firm owner can unarchive customers");
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
 * Returns null on any failure (unauthenticated, not provisioned, not
 * authorised, customer doesn't exist) so the UI can render a tasteful
 * empty state. Uses `tryGetActor` instead of `getActor` for that reason.
 */
export const get = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return null;
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const allowed = await canSeeCustomer(ctx, actor, args.customerId);
    return allowed ? customer : null;
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

// ===== Client portal access =============================================

const clientRoleValidator = v.union(
  v.literal("client_owner"),
  v.literal("client_viewer"),
);

/** Invite a client by email, or link immediately if the email matches a user. */
export const inviteClient = mutation({
  args: {
    customerId: v.id("customers"),
    email: v.string(),
    role: v.optional(clientRoleValidator),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage client access");
    }
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No access to this workspace");
    }
    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("Invalid email");
    }
    const role = args.role ?? "client_owner";

    // If a user with this email already exists, link them immediately.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existingUser) {
      const existingAccess = await ctx.db
        .query("customer_access")
        .withIndex("by_customer_and_user", (q) =>
          q.eq("customerId", args.customerId).eq("userId", existingUser._id),
        )
        .first();
      if (existingAccess) {
        return { kind: "already_linked" as const, accessId: existingAccess._id };
      }
      const accessId = await ctx.db.insert("customer_access", {
        customerId: args.customerId,
        userId: existingUser._id,
        role,
        invitedBy: actor.userId,
        invitedAt: Date.now(),
      });
      await ctx.db.insert("audit_log", {
        workspaceId: customer.workspaceId,
        actorId: actor.userId,
        subjectKind: "customer",
        subjectTable: "customer_access",
        subjectId: accessId,
        action: "create",
        after: { email, role, customerId: args.customerId },
        superadminContext: isSuperadmin(actor)
          ? { reason: actor.sessionReason }
          : undefined,
      });
      return { kind: "linked" as const, accessId };
    }

    // Otherwise queue a pending invite that ensureUser will resolve.
    const existingInvite = await ctx.db
      .query("client_invites")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", "pending"),
      )
      .collect();
    const dup = existingInvite.find(
      (i) => i.customerId === args.customerId && i.status === "pending",
    );
    if (dup) {
      return { kind: "already_invited" as const, inviteId: dup._id };
    }

    const inviteId = await ctx.db.insert("client_invites", {
      customerId: args.customerId,
      workspaceId: customer.workspaceId,
      email,
      role,
      invitedBy: actor.userId,
      status: "pending",
    });

    // Dispatch a real invitation email via Clerk. The action runs out-of-band;
    // on success it patches `clerkInvitationId` onto the row. If Clerk isn't
    // configured the invite stays pending and resolves on next sign-in via
    // the email-match path in `ensureUser`.
    await ctx.scheduler.runAfter(
      0,
      internal.clerkInvites.sendInviteEmail,
      { inviteId },
    );

    return { kind: "pending" as const, inviteId };
  },
});

/** Revoke an active customer_access row. */
export const revokeClientAccess = mutation({
  args: { accessId: v.id("customer_access") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage client access");
    }
    const access = await ctx.db.get(args.accessId);
    if (!access) throw new Error("Access row not found");
    const customer = await ctx.db.get(access.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No access to this workspace");
    }
    await ctx.db.delete(args.accessId);
    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "customer",
      subjectTable: "customer_access",
      subjectId: args.accessId,
      action: "delete",
      before: {
        customerId: access.customerId,
        userId: access.userId,
        role: access.role,
      },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });
    return null;
  },
});

/** Cancel a still-pending invite. */
export const cancelClientInvite = mutation({
  args: { inviteId: v.id("client_invites") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage client access");
    }
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invite not found");
    if (!canActInWorkspace(actor, invite.workspaceId)) {
      throw new Error("No access to this workspace");
    }
    if (invite.status !== "pending") {
      // Idempotent: deleting an already-accepted invite isn't useful.
      return null;
    }
    await ctx.db.patch(args.inviteId, { status: "revoked" });
    return null;
  },
});

/** List active access rows + pending invites for a customer. */
export const listClientAccess = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return { active: [], pending: [] };
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return { active: [], pending: [] };
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) {
      return { active: [], pending: [] };
    }

    const accessRows = await ctx.db
      .query("customer_access")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .take(100);
    const users = await Promise.all(accessRows.map((a) => ctx.db.get(a.userId)));
    const active = accessRows.map((a, i) => {
      const u = users[i];
      return {
        accessId: a._id,
        userId: a.userId,
        role: a.role,
        invitedAt: a.invitedAt,
        lastSeenAt: a.lastSeenAt ?? null,
        displayName: u?.displayName ?? "Unknown",
        email: u?.email ?? null,
        avatarUrl: u?.avatarUrl ?? null,
      };
    });

    const invites = await ctx.db
      .query("client_invites")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .take(100);
    const pending = invites
      .filter((i) => i.status === "pending")
      .map((i) => ({
        inviteId: i._id,
        email: i.email,
        role: i.role,
        invitedAt: i._creationTime,
      }));

    return { active, pending };
  },
});

/**
 * INTERNAL: resolve all pending invites for an email into customer_access
 * rows. Called from `ensureUser` after the user row exists. Idempotent.
 */
export async function consumePendingClientInvites(
  ctx: import("./_generated/server").MutationCtx,
  userId: Id<"users">,
  email: string | undefined,
) {
  if (!email) return;
  const normalized = email.toLowerCase();
  const pending = await ctx.db
    .query("client_invites")
    .withIndex("by_email_and_status", (q) =>
      q.eq("email", normalized).eq("status", "pending"),
    )
    .take(50);
  for (const invite of pending) {
    const existing = await ctx.db
      .query("customer_access")
      .withIndex("by_customer_and_user", (q) =>
        q.eq("customerId", invite.customerId).eq("userId", userId),
      )
      .first();
    let accessId: Id<"customer_access">;
    if (existing) {
      accessId = existing._id;
    } else {
      accessId = await ctx.db.insert("customer_access", {
        customerId: invite.customerId,
        userId,
        role: invite.role,
        invitedBy: invite.invitedBy,
        invitedAt: Date.now(),
      });
    }
    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: Date.now(),
      acceptedAccessId: accessId,
    });
  }
}
