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

    let userId;

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
      userId = existing._id;
    } else {
      userId = await ctx.db.insert("users", {
        kind: "human",
        clerkId: identity.subject,
        email: identity.email ?? undefined,
        displayName,
        avatarUrl: identity.pictureUrl ?? undefined,
      });
    }

    // Auto-mirror Clerk organisation membership.
    // When the user signs in with an active org context (Clerk JWT includes
    // {{org.id}} and {{org.role}}), and we have a Cockpit workspace
    // pointing at that Clerk org, auto-create a Cockpit membership for them.
    // This covers team-invite acceptance flows.
    const clerkOrgId = (identity as { organizationId?: string })
      .organizationId;
    const clerkOrgRole = (identity as { organizationRole?: string })
      .organizationRole;
    if (clerkOrgId) {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
        .unique();
      if (workspace) {
        const existingMembership = await ctx.db
          .query("memberships")
          .withIndex("by_workspace_and_user", (q) =>
            q.eq("workspaceId", workspace._id).eq("userId", userId),
          )
          .unique();
        if (!existingMembership) {
          // Map Clerk role → Cockpit role (best effort)
          const role =
            clerkOrgRole === "org:admin" || clerkOrgRole === "admin"
              ? ("admin" as const)
              : ("member" as const);
          await ctx.db.insert("memberships", {
            workspaceId: workspace._id,
            userId,
            role,
            scope: "all",
          });
        } else if (existingMembership.archived) {
          await ctx.db.patch(existingMembership._id, { archived: false });
        }
      }
    }

    // Auto-promote founders to superadmin based on the SUPERADMIN_EMAILS
    // env var on the Convex deployment (comma-separated). Idempotent.
    const superadminEmailsRaw = process.env.SUPERADMIN_EMAILS ?? "";
    const superadminEmails = superadminEmailsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (
      identity.email &&
      superadminEmails.includes(identity.email.toLowerCase())
    ) {
      const existingSA = await ctx.db
        .query("superadmins")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (!existingSA) {
        await ctx.db.insert("superadmins", {
          userId,
          reason: "founder (auto-provisioned from SUPERADMIN_EMAILS)",
        });
      } else if (existingSA.archived) {
        // Reactivate if previously archived
        await ctx.db.patch(existingSA._id, { archived: false });
      }
    }

    return userId;
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
            : actor.kind === "client"
              ? ({
                  kind: "client" as const,
                  customerCount: actor.customerAccess.length,
                })
              : ({
                  kind: "superadmin" as const,
                  activeWorkspaceId: actor.activeWorkspaceId ?? null,
                  hasSession: actor.sessionId !== undefined,
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
