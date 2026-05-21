import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/**
 * Actor — the resolved identity of whoever made the current request.
 *
 * Every Convex function that touches user data should call `getActor(ctx)`
 * first. There are three populations:
 *
 *   • member     — a firm employee, scoped to one workspace
 *   • client     — an end-customer with portal access to one or more customers
 *   • superadmin — Cockpit staff with cross-workspace capability (their own
 *                  identity, no Clerk org membership required)
 *
 * Resolution order:
 *   1. If the user has an *active* superadmin session, return SuperadminActor
 *      with that session's workspace as the impersonation context.
 *   2. Else if they have a membership, return MemberActor.
 *   3. Else if they have customer_access rows, return ClientActor.
 *   4. Else if they're a superadmin without a session, return a SuperadminActor
 *      with no activeWorkspaceId (they need to pick a workspace).
 *   5. Else null.
 *
 * `getActor` throws; `tryGetActor` returns null on no access.
 */

export type MemberActor = {
  kind: "member";
  userId: Id<"users">;
  user: Doc<"users">;
  workspaceId: Id<"workspaces">;
  membership: Doc<"memberships">;
  role: "owner" | "admin" | "member";
  scope: "all" | "assigned_only";
};

export type ClientActor = {
  kind: "client";
  userId: Id<"users">;
  user: Doc<"users">;
  customerAccess: Doc<"customer_access">[];
};

export type SuperadminActor = {
  kind: "superadmin";
  userId: Id<"users">;
  user: Doc<"users">;
  /** The workspace this superadmin is currently impersonating, if any. */
  activeWorkspaceId?: Id<"workspaces">;
  /** Pointer to the session row so writes can stamp it onto audit log. */
  sessionId?: Id<"superadmin_sessions">;
  /** Reason the superadmin entered this session (for audit). */
  sessionReason?: string;
  /** Effective role inside the impersonated workspace. Always "owner". */
  effectiveRole: "owner";
};

export type Actor = MemberActor | ClientActor | SuperadminActor;

// -- Resolution ----------------------------------------------------------

async function loadUser(ctx: QueryCtx | MutationCtx, clerkSubject: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkSubject))
    .unique();
}

async function loadSuperadmin(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const row = await ctx.db
    .query("superadmins")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return row && !row.archived ? row : null;
}

async function loadActiveSuperadminSession(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  // Take the most-recently created session for this user and verify it's open
  const latest = await ctx.db
    .query("superadmin_sessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  return latest && latest.endedAt === undefined ? latest : null;
}

/** Resolve the actor or return null. */
export async function tryGetActor(
  ctx: QueryCtx | MutationCtx,
): Promise<Actor | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const user = await loadUser(ctx, identity.subject);
  if (!user) return null;

  const superadmin = await loadSuperadmin(ctx, user._id);

  // 1. Active superadmin impersonation takes precedence
  if (superadmin) {
    const session = await loadActiveSuperadminSession(ctx, user._id);
    if (session) {
      return {
        kind: "superadmin",
        userId: user._id,
        user,
        activeWorkspaceId: session.activeWorkspaceId,
        sessionId: session._id,
        sessionReason: session.reason,
        effectiveRole: "owner",
      };
    }
  }

  // 2. Member of a workspace
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();

  if (membership && !membership.archived) {
    return {
      kind: "member",
      userId: user._id,
      user,
      workspaceId: membership.workspaceId,
      membership,
      role: membership.role,
      scope: membership.scope,
    };
  }

  // 3. Client with portal access
  const customerAccess = await ctx.db
    .query("customer_access")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(100);

  if (customerAccess.length > 0) {
    return {
      kind: "client",
      userId: user._id,
      user,
      customerAccess,
    };
  }

  // 4. Superadmin without a session and without their own workspace —
  // returns a "limbo" superadmin actor. They need to pick a workspace.
  if (superadmin) {
    return {
      kind: "superadmin",
      userId: user._id,
      user,
      activeWorkspaceId: undefined,
      sessionId: undefined,
      sessionReason: undefined,
      effectiveRole: "owner",
    };
  }

  return null;
}

/** Resolve the actor or throw. */
export async function getActor(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const actor = await tryGetActor(ctx);
  if (!actor) throw new Error("Not authorised");
  return actor;
}

// -- Predicates ----------------------------------------------------------

export function isMember(actor: Actor): actor is MemberActor {
  return actor.kind === "member";
}

export function isClient(actor: Actor): actor is ClientActor {
  return actor.kind === "client";
}

export function isSuperadmin(actor: Actor): actor is SuperadminActor {
  return actor.kind === "superadmin";
}

/**
 * Is this actor allowed to read/write data inside `workspaceId`?
 *   • member     — only their own workspace
 *   • superadmin — only the workspace currently in their session
 *   • client     — never (clients act on specific customers, not workspaces)
 */
export function canActInWorkspace(
  actor: Actor,
  workspaceId: Id<"workspaces">,
): boolean {
  if (isSuperadmin(actor)) return actor.activeWorkspaceId === workspaceId;
  if (isMember(actor)) return actor.workspaceId === workspaceId;
  return false;
}

export function canManageTeam(actor: Actor): boolean {
  if (isSuperadmin(actor)) return actor.activeWorkspaceId !== undefined;
  return isMember(actor) && (actor.role === "owner" || actor.role === "admin");
}

export function canManageModules(actor: Actor): boolean {
  if (isSuperadmin(actor)) return actor.activeWorkspaceId !== undefined;
  return isMember(actor) && (actor.role === "owner" || actor.role === "admin");
}

/** Only superadmins can list all workspaces across tenants. */
export function canListAllWorkspaces(actor: Actor): boolean {
  return isSuperadmin(actor);
}

/**
 * Does this actor have access to a particular customer?
 */
export async function canSeeCustomer(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  customerId: Id<"customers">,
): Promise<boolean> {
  const customer = await ctx.db.get(customerId);
  if (!customer) return false;

  if (isClient(actor)) {
    return actor.customerAccess.some((a) => a.customerId === customerId);
  }

  if (isSuperadmin(actor)) {
    return actor.activeWorkspaceId === customer.workspaceId;
  }

  // member
  if (customer.workspaceId !== actor.workspaceId) return false;
  if (actor.scope === "all") return true;

  const assignment = await ctx.db
    .query("customer_assignments")
    .withIndex("by_workspace_and_user", (q) =>
      q.eq("workspaceId", actor.workspaceId).eq("userId", actor.userId),
    )
    .filter((q) => q.eq(q.field("customerId"), customerId))
    .first();

  return assignment !== null;
}
