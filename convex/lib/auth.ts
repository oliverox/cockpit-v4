import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/**
 * Actor — the resolved identity of whoever made the current request.
 *
 * Every Convex function that touches user data should call `getActor(ctx)`
 * first. There are two populations:
 *
 *   • member  — a firm employee, scoped to one workspace
 *   • client  — an end-customer with portal access to one or more customers
 *
 * `getActor` throws if the request is unauthenticated or has no access.
 * Use `tryGetActor` when null-on-no-access is the correct behaviour
 * (e.g. the public `whoAmI` query).
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

export type Actor = MemberActor | ClientActor;

/**
 * Resolve the actor or return null. Use this when "not signed in" or
 * "no access yet" is an expected state to handle gracefully.
 */
export async function tryGetActor(
  ctx: QueryCtx | MutationCtx,
): Promise<Actor | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) return null;

  // Try as firm member first
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

  // Try as client
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

  // User row exists but has no workspace and no client access.
  // This is a transitional state (e.g. just signed up, not yet invited).
  return null;
}

/**
 * Resolve the actor or throw. Use this in any function that requires an
 * authenticated, provisioned actor.
 */
export async function getActor(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const actor = await tryGetActor(ctx);
  if (!actor) throw new Error("Not authorised");
  return actor;
}

// -- Permission helpers --------------------------------------------------

export function isMember(actor: Actor): actor is MemberActor {
  return actor.kind === "member";
}

export function isClient(actor: Actor): actor is ClientActor {
  return actor.kind === "client";
}

export function canManageTeam(actor: Actor): boolean {
  return isMember(actor) && (actor.role === "owner" || actor.role === "admin");
}

export function canManageModules(actor: Actor): boolean {
  return isMember(actor) && (actor.role === "owner" || actor.role === "admin");
}

/**
 * Does this actor have access to a particular customer?
 *
 *   • member with scope "all"          → yes
 *   • member with scope "assigned_only" → only if a customer_assignments row exists
 *   • client                            → only if a customer_access row exists for it
 */
export async function canSeeCustomer(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  customerId: Id<"customers">,
): Promise<boolean> {
  if (isClient(actor)) {
    return actor.customerAccess.some((a) => a.customerId === customerId);
  }

  if (actor.scope === "all") return true;

  // assigned_only — check the assignments table
  const assignment = await ctx.db
    .query("customer_assignments")
    .withIndex("by_workspace_and_user", (q) =>
      q.eq("workspaceId", actor.workspaceId).eq("userId", actor.userId),
    )
    .filter((q) => q.eq(q.field("customerId"), customerId))
    .first();

  return assignment !== null;
}
