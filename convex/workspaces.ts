import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { tryGetActor } from "./lib/auth";

/**
 * Create a workspace (firm). Cockpit-only — no Clerk Organization involved.
 *
 * Rules:
 *   • Caller must be signed in and provisioned via `ensureUser`.
 *   • One user can only own one firm. If the caller already has any
 *     non-archived membership, refuse — they should use a different email
 *     if they're starting a second firm.
 *   • The creator gets a `role: "owner"` membership scoped to all customers.
 */
export const create = mutation({
  args: {
    name: v.string(),
    industryTags: v.optional(v.array(v.string())),
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
    if (!name) throw new Error("Firm name cannot be empty");
    if (name.length > 100) throw new Error("Firm name too long");

    const existingMembership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (existingMembership && !existingMembership.archived) {
      throw new Error("You already belong to a firm.");
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      installedModules: [],
      industryTags: args.industryTags,
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
      after: { name },
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
