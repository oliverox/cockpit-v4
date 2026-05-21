import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { tryGetActor } from "./lib/auth";

/**
 * Upsert the current Clerk user into our `users` table.
 *
 * Called from the client when auth becomes ready (see hooks/use-ensure-user.ts).
 * Idempotent — safe to call on every auth event.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    const displayName =
      identity.name ?? identity.givenName ?? identity.email ?? "User";

    if (existing) {
      // Refresh profile fields if Clerk has newer values
      const patch: Record<string, unknown> = {};
      if (identity.name && existing.displayName !== identity.name) {
        patch.displayName = identity.name;
      }
      if (identity.email && existing.email !== identity.email) {
        patch.email = identity.email;
      }
      if (
        identity.pictureUrl &&
        existing.avatarUrl !== identity.pictureUrl
      ) {
        patch.avatarUrl = identity.pictureUrl;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      kind: "human",
      clerkId: identity.subject,
      email: identity.email ?? undefined,
      displayName,
      avatarUrl: identity.pictureUrl ?? undefined,
    });
  },
});

/**
 * `whoAmI` — smoke-test query for the auth chain. Returns:
 *
 *   • null if signed out
 *   • { provisioned: false, clerk: {...} } if signed in but no Convex user row yet
 *   • { provisioned: true, user: {...}, actor: {...} | null } once provisioned
 *
 * `actor` is null for users who exist but have no workspace or customer access yet
 * (transitional state — e.g. they just signed up but haven't been invited anywhere).
 */
export const whoAmI = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      return {
        provisioned: false as const,
        clerk: {
          subject: identity.subject,
          email: identity.email ?? null,
          name: identity.name ?? null,
        },
      };
    }

    const actor = await tryGetActor(ctx);

    return {
      provisioned: true as const,
      user: {
        id: user._id,
        displayName: user.displayName,
        email: user.email ?? null,
        avatarUrl: user.avatarUrl ?? null,
      },
      actor:
        actor === null
          ? null
          : actor.kind === "member"
            ? ({
                kind: "member" as const,
                workspaceId: actor.workspaceId,
                role: actor.role,
                scope: actor.scope,
              })
            : ({
                kind: "client" as const,
                customerCount: actor.customerAccess.length,
              }),
    };
  },
});

/**
 * Get the current user's Convex row. Returns null if not signed in or not provisioned.
 * Used widely by client UI that needs the user's display name, avatar, etc.
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});
