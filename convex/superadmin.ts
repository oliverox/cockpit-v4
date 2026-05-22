import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { tryGetActor, isSuperadmin } from "./lib/auth";

/**
 * Lightweight predicate — does the current user have a superadmin row?
 * Returns true regardless of whether they have an active impersonation
 * session, so the banner UI can always show.
 */
export const amISuperadmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return false;

    const row = await ctx.db
      .query("superadmins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    return Boolean(row && !row.archived);
  },
});

/**
 * Begin (or replace) a superadmin impersonation session pointing at a
 * specific workspace. Caller must be a superadmin.
 *
 * Any currently-active session for this user is closed (`endedAt` set)
 * before the new one is opened. We also write an audit_log row capturing
 * the workspace entered.
 */
export const enterWorkspace = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned");

    const superadmin = await ctx.db
      .query("superadmins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!superadmin || superadmin.archived) {
      throw new Error("Not a superadmin");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    // Close any active session
    const current = await ctx.db
      .query("superadmin_sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    if (current && current.endedAt === undefined) {
      await ctx.db.patch(current._id, { endedAt: Date.now() });
    }

    const sessionId = await ctx.db.insert("superadmin_sessions", {
      userId: user._id,
      activeWorkspaceId: args.workspaceId,
      reason: args.reason,
      startedAt: Date.now(),
    });

    await ctx.db.insert("audit_log", {
      workspaceId: args.workspaceId,
      actorId: user._id,
      subjectKind: "workspace",
      subjectTable: "workspaces",
      subjectId: args.workspaceId,
      action: "override",
      reason: args.reason,
      superadminContext: { reason: args.reason },
    });

    return sessionId;
  },
});

/** End the current superadmin session, if any. */
export const exitWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;

    const current = await ctx.db
      .query("superadmin_sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    if (current && current.endedAt === undefined) {
      await ctx.db.patch(current._id, { endedAt: Date.now() });
    }
    return null;
  },
});

/**
 * List every workspace in the system. Returns null if the caller is not
 * a superadmin.
 *
 * Checks the `superadmins` table directly (not `actor.kind`) because a
 * staff member with their own workspace membership resolves to a
 * MemberActor by default — they're still allowed to list all workspaces.
 */
export const listAllWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;

    const row = await ctx.db
      .query("superadmins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!row || row.archived) return null;

    return await ctx.db.query("workspaces").take(200);
  },
});

/**
 * Dev-only: wipe all firm/customer/workflow data while keeping `users` and
 * `superadmins` rows. Useful after a structural refactor (e.g. dropping
 * Clerk Organizations). Superadmin-gated.
 *
 *   npx convex run superadmin:devResetWorkspaceData
 *
 * Order matters: leaf tables first so deletes don't cascade-leave stale fks.
 */
export const devResetWorkspaceData = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new Error("User not provisioned");
    const sa = await ctx.db
      .query("superadmins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!sa || sa.archived) {
      throw new Error("Only superadmins can run this");
    }

    const tablesInOrder = [
      "task_approvals",
      "tasks",
      "documents",
      "messages",
      "thread_members",
      "threads",
      "calendar_events",
      "events",
      "inbox_items",
      "audit_log",
      "module_settings",
      "connectors",
      "connector_imports",
      "control_tower_sessions",
      "customer_assignments",
      "customer_access",
      "client_invites",
      "team_invites",
      "customers",
      "memberships",
      "workspaces",
      "superadmin_sessions",
    ] as const;

    let total = 0;
    for (const table of tablesInOrder) {
      const rows = await ctx.db.query(table).take(5000);
      for (const r of rows) {
        await ctx.db.delete(r._id);
        total++;
      }
    }
    return { deleted: total };
  },
});
