import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canManageTeam,
  getActor,
  isMember,
  isSuperadmin,
  isSuperadmin as _isSuperadmin,
  tryGetActor,
} from "./lib/auth";

const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
);
const scopeValidator = v.union(
  v.literal("all"),
  v.literal("assigned_only"),
);

function actorWorkspace(
  actor: Awaited<ReturnType<typeof getActor>>,
): Id<"workspaces"> | null {
  if (isMember(actor)) return actor.workspaceId;
  if (isSuperadmin(actor)) return actor.activeWorkspaceId ?? null;
  return null;
}

/** List memberships in the active workspace, with user info attached. */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];
    const workspaceId =
      actor.kind === "member"
        ? actor.workspaceId
        : actor.kind === "superadmin"
          ? actor.activeWorkspaceId
          : null;
    if (!workspaceId) return [];

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(200);

    const userIds = memberships.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    return memberships
      .map((m, i) => {
        const u = users[i];
        if (!u) return null;
        return {
          membershipId: m._id,
          userId: m.userId,
          role: m.role,
          scope: m.scope,
          archived: m.archived === true,
          displayName: u.displayName,
          email: u.email ?? null,
          avatarUrl: u.avatarUrl ?? null,
          kind: u.kind,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  },
});

/** Update a member's role. Only owners/admins can. Can't demote an owner. */
export const updateRole = mutation({
  args: {
    membershipId: v.id("memberships"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only admins can manage team members");
    }
    const target = await ctx.db.get(args.membershipId);
    if (!target) throw new Error("Membership not found");
    const ws = actorWorkspace(actor);
    if (!ws || target.workspaceId !== ws) {
      throw new Error("No access to this membership");
    }
    if (target.role === "owner" && args.role !== "owner") {
      throw new Error("Cannot demote the workspace owner");
    }

    const before = { role: target.role };
    await ctx.db.patch(args.membershipId, { role: args.role });

    await ctx.db.insert("audit_log", {
      workspaceId: target.workspaceId,
      actorId: actor.userId,
      subjectKind: "membership",
      subjectTable: "memberships",
      subjectId: args.membershipId,
      action: "update",
      before,
      after: { role: args.role },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });
    return null;
  },
});

/** Update a member's customer-scope. Only owners/admins can. */
export const updateScope = mutation({
  args: {
    membershipId: v.id("memberships"),
    scope: scopeValidator,
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only admins can manage team members");
    }
    const target = await ctx.db.get(args.membershipId);
    if (!target) throw new Error("Membership not found");
    const ws = actorWorkspace(actor);
    if (!ws || target.workspaceId !== ws) {
      throw new Error("No access to this membership");
    }

    const before = { scope: target.scope };
    await ctx.db.patch(args.membershipId, { scope: args.scope });

    await ctx.db.insert("audit_log", {
      workspaceId: target.workspaceId,
      actorId: actor.userId,
      subjectKind: "membership",
      subjectTable: "memberships",
      subjectId: args.membershipId,
      action: "update",
      before,
      after: { scope: args.scope },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });
    return null;
  },
});
