import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  canManageTeam,
  getActor,
  isMember,
  isSuperadmin,
  tryGetActor,
} from "./lib/auth";
import { internal } from "./_generated/api";
import { MutationCtx } from "./_generated/server";

const roleValidator = v.union(v.literal("owner"), v.literal("member"));
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

// ---- Members -----------------------------------------------------------

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

/** Update a member's role. Only the owner can. Can't demote the only owner. */
export const updateRole = mutation({
  args: {
    membershipId: v.id("memberships"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage team members");
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

/** Update a member's customer-scope. Only the owner can. */
export const updateScope = mutation({
  args: {
    membershipId: v.id("memberships"),
    scope: scopeValidator,
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage team members");
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

// ---- Invites -----------------------------------------------------------

/**
 * Invite a team member by email. Owner-only.
 *
 * If a Convex user already exists with that email AND they don't yet belong
 * to any firm, they're linked immediately. Otherwise a pending `team_invites`
 * row is created and a Clerk magic-link email is dispatched out-of-band.
 */
export const inviteTeamMember = mutation({
  args: {
    email: v.string(),
    role: v.optional(roleValidator),
    scope: v.optional(scopeValidator),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can invite team members");
    }
    const workspaceId = actorWorkspace(actor);
    if (!workspaceId) throw new Error("No active workspace");

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("Invalid email");
    }
    const role = args.role ?? "member";
    const scope = args.scope ?? "all";

    // Link immediately if the email already belongs to a Convex user who
    // is not yet in a firm.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existingUser) {
      const existingMembership = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", existingUser._id))
        .first();
      if (existingMembership && !existingMembership.archived) {
        if (existingMembership.workspaceId === workspaceId) {
          return {
            kind: "already_linked" as const,
            membershipId: existingMembership._id,
          };
        }
        throw new Error(
          "That user already belongs to a different firm. They need to use a different email.",
        );
      }
      const membershipId = await ctx.db.insert("memberships", {
        workspaceId,
        userId: existingUser._id,
        role,
        scope,
      });
      await ctx.db.insert("audit_log", {
        workspaceId,
        actorId: actor.userId,
        subjectKind: "membership",
        subjectTable: "memberships",
        subjectId: membershipId,
        action: "create",
        after: { email, role, scope },
        superadminContext: isSuperadmin(actor)
          ? { reason: actor.sessionReason }
          : undefined,
      });
      return { kind: "linked" as const, membershipId };
    }

    // Otherwise queue a pending invite (and dispatch the email).
    const existingPending = await ctx.db
      .query("team_invites")
      .withIndex("by_workspace_and_email", (q) =>
        q.eq("workspaceId", workspaceId).eq("email", email),
      )
      .collect();
    const dup = existingPending.find((i) => i.status === "pending");
    if (dup) {
      return { kind: "already_invited" as const, inviteId: dup._id };
    }

    const inviteId = await ctx.db.insert("team_invites", {
      workspaceId,
      email,
      role,
      scope,
      invitedBy: actor.userId,
      status: "pending",
    });

    await ctx.scheduler.runAfter(
      0,
      internal.clerkInvites.sendTeamInviteEmail,
      { inviteId },
    );

    return { kind: "pending" as const, inviteId };
  },
});

/** Cancel a still-pending team invite. */
export const cancelTeamInvite = mutation({
  args: { inviteId: v.id("team_invites") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage invites");
    }
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invite not found");
    const ws = actorWorkspace(actor);
    if (!ws || invite.workspaceId !== ws) {
      throw new Error("No access to this invite");
    }
    if (invite.status !== "pending") return null;
    await ctx.db.patch(args.inviteId, { status: "revoked" });
    return null;
  },
});

/** Archive (= remove) a team member. Owner-only. */
export const archiveMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (!canManageTeam(actor)) {
      throw new Error("Only the firm owner can manage team members");
    }
    const m = await ctx.db.get(args.membershipId);
    if (!m) throw new Error("Membership not found");
    const ws = actorWorkspace(actor);
    if (!ws || m.workspaceId !== ws) {
      throw new Error("No access to this membership");
    }
    if (m.role === "owner") {
      throw new Error("Cannot remove the workspace owner");
    }
    await ctx.db.patch(args.membershipId, { archived: true });
    return null;
  },
});

/** List pending team invites for the active workspace. */
export const listTeamInvites = query({
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
    const all = await ctx.db
      .query("team_invites")
      .withIndex("by_workspace_and_email", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .take(200);
    return all
      .filter((i) => i.status === "pending")
      .map((i) => ({
        inviteId: i._id,
        email: i.email,
        role: i.role,
        scope: i.scope,
        invitedAt: i._creationTime,
        clerkInviteError: i.clerkInviteError ?? null,
      }));
  },
});

// ---- Internal: invite consumption -------------------------------------

/**
 * Resolve all pending team invites for a given email into `memberships`
 * rows. Called from `ensureUser`. A user with an existing non-archived
 * membership keeps their existing one; the invite is left pending (the
 * inviting firm needs to know they need a different email).
 */
export async function consumePendingTeamInvites(
  ctx: MutationCtx,
  userId: Id<"users">,
  email: string | undefined,
) {
  if (!email) return;
  const normalized = email.toLowerCase();

  // Single-firm guard: if the user already belongs to a firm, don't
  // materialize team invites — they'd need to use a different email.
  const existingMembership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (existingMembership && !existingMembership.archived) return;

  const pending = await ctx.db
    .query("team_invites")
    .withIndex("by_email_and_status", (q) =>
      q.eq("email", normalized).eq("status", "pending"),
    )
    .take(20);
  if (pending.length === 0) return;

  // Take the first one (alphabetical / first-inserted). Single-firm rule
  // means only one can resolve; the rest get marked revoked.
  const [first, ...rest] = pending;
  const membershipId = await ctx.db.insert("memberships", {
    workspaceId: first.workspaceId,
    userId,
    role: first.role,
    scope: first.scope,
  });
  await ctx.db.patch(first._id, {
    status: "accepted",
    acceptedAt: Date.now(),
    acceptedMembershipId: membershipId,
  });
  for (const other of rest) {
    await ctx.db.patch(other._id, { status: "revoked" });
  }
}

