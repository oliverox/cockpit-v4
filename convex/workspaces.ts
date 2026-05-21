import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { tryGetActor } from "./lib/auth";

/**
 * Create a workspace after the client has created the matching Clerk
 * organisation. Idempotent: if a workspace already exists for this
 * `clerkOrgId`, we just ensure the caller has an owner membership and
 * return the existing row.
 *
 * Trust model for Phase 1.0: we accept the client-supplied `clerkOrgId`.
 * Server-side verification (via a Convex action calling Clerk's admin API,
 * or a Clerk webhook) will be added in a later step.
 */
export const create = mutation({
  args: {
    name: v.string(),
    clerkOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned. Call ensureUser first.");

    const name = args.name.trim();
    if (!name) throw new Error("Workspace name cannot be empty");
    if (name.length > 100) throw new Error("Workspace name too long");

    // Idempotent path: workspace already linked to this Clerk org
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .unique();

    if (existing) {
      // Make sure the caller has a membership on it (recovery from partial setup)
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_workspace_and_user", (q) =>
          q.eq("workspaceId", existing._id).eq("userId", user._id),
        )
        .unique();

      if (!membership) {
        await ctx.db.insert("memberships", {
          workspaceId: existing._id,
          userId: user._id,
          role: "owner",
          scope: "all",
        });
      }
      return existing._id;
    }

    // Fresh creation
    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      clerkOrgId: args.clerkOrgId,
      installedModules: [],
    });

    await ctx.db.insert("memberships", {
      workspaceId,
      userId: user._id,
      role: "owner",
      scope: "all",
    });

    await ctx.db.insert("audit_log", {
      workspaceId,
      actorId: user._id,
      subjectKind: "workspace",
      subjectTable: "workspaces",
      subjectId: workspaceId,
      action: "create",
      after: { name, clerkOrgId: args.clerkOrgId },
    });

    return workspaceId;
  },
});

/**
 * The actor's currently-active workspace.
 *   • member     → their membership's workspace
 *   • superadmin → the workspace in their current session (may be null)
 *   • client     → null (clients don't have a workspace context)
 *   • unauth     → null
 */
export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return null;

    const workspaceId =
      actor.kind === "member"
        ? actor.workspaceId
        : actor.kind === "superadmin"
          ? actor.activeWorkspaceId
          : null;

    if (!workspaceId) return null;
    return await ctx.db.get(workspaceId);
  },
});

/**
 * Workspaces the current user belongs to (via memberships). Used by the
 * future workspace switcher. Excludes archived memberships.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);

    const workspaces = await Promise.all(
      memberships
        .filter((m) => !m.archived)
        .map((m) => ctx.db.get(m.workspaceId)),
    );

    return workspaces.filter(
      (w): w is NonNullable<typeof w> => w !== null,
    );
  },
});

/**
 * Lightweight onboarding-state query — used by the (app) layout and the
 * landing page to decide where to send the user after sign-in.
 *
 * Returns one of:
 *   • { state: "needs_workspace" }      — signed in, no membership, no pending invite
 *   • { state: "has_workspace" }        — signed in, has a workspace
 *   • { state: "client_only" }          — signed in, only customer_access (use portal)
 *   • { state: "superadmin_no_session" } — signed in, superadmin without an active session
 *   • { state: "unauthenticated" }      — not signed in
 */
export const onboardingState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { state: "unauthenticated" as const };

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return { state: "needs_workspace" as const };

    const actor = await tryGetActor(ctx);

    if (actor === null) return { state: "needs_workspace" as const };

    if (actor.kind === "member") return { state: "has_workspace" as const };
    if (actor.kind === "client") return { state: "client_only" as const };

    // superadmin
    if (actor.activeWorkspaceId)
      return { state: "has_workspace" as const };
    return { state: "superadmin_no_session" as const };
  },
});
