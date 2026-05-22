import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Clerk Invitations API integration for client-portal invites.
 *
 * Scheduled from `customers.inviteClient` whenever a pending invite is
 * created (i.e. the email doesn't yet match a Convex user). Posts a real
 * branded invitation email via Clerk and stores the returned invitation id
 * on the `client_invites` row.
 *
 * Required Convex deployment env vars:
 *   CLERK_SECRET_KEY — from the Clerk dashboard (server key)
 *   APP_URL         — base URL the magic link should redirect to (e.g.
 *                     "https://cockpit.facture.mu" or
 *                     "http://localhost:3011" for local dev)
 *
 * If either is missing, this gracefully no-ops with a warning logged. The
 * pending invite still resolves on first sign-in via the email match path.
 */

// ---- Helpers exposed only to actions / other Convex functions ----------

export const _getInvite = internalQuery({
  args: { inviteId: v.id("client_invites") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.inviteId);
  },
});

export const _markInviteSent = internalMutation({
  args: {
    inviteId: v.id("client_invites"),
    clerkInvitationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, {
      clerkInvitationId: args.clerkInvitationId,
      clerkInviteError: undefined,
    });
  },
});

export const _markInviteError = internalMutation({
  args: { inviteId: v.id("client_invites"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, { clerkInviteError: args.error });
  },
});

export const _getTeamInvite = internalQuery({
  args: { inviteId: v.id("team_invites") },
  handler: async (ctx, args) => ctx.db.get(args.inviteId),
});

export const _markTeamInviteSent = internalMutation({
  args: {
    inviteId: v.id("team_invites"),
    clerkInvitationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, {
      clerkInvitationId: args.clerkInvitationId,
      clerkInviteError: undefined,
    });
  },
});

export const _markTeamInviteError = internalMutation({
  args: { inviteId: v.id("team_invites"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inviteId, { clerkInviteError: args.error });
  },
});

// ---- Action ------------------------------------------------------------

export const sendInviteEmail = internalAction({
  args: { inviteId: v.id("client_invites") },
  handler: async (ctx, args) => {
    const invite = await ctx.runQuery(internal.clerkInvites._getInvite, {
      inviteId: args.inviteId,
    });
    if (!invite) return;
    if (invite.status !== "pending") return;
    if (invite.clerkInvitationId) return; // already sent

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      console.warn(
        "[clerkInvites] CLERK_SECRET_KEY not set; skipping email for invite",
        args.inviteId,
      );
      await ctx.runMutation(internal.clerkInvites._markInviteError, {
        inviteId: args.inviteId,
        error: "CLERK_SECRET_KEY not configured",
      });
      return;
    }

    const appUrl = process.env.APP_URL ?? "http://localhost:3011";
    const redirectUrl = `${appUrl.replace(/\/$/, "")}/portal`;

    let res: Response;
    try {
      res = await fetch("https://api.clerk.com/v1/invitations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address: invite.email,
          redirect_url: redirectUrl,
          public_metadata: {
            cockpit_kind: "client_invite",
            customerId: invite.customerId,
          },
          notify: true,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clerkInvites] network error:", message);
      await ctx.runMutation(internal.clerkInvites._markInviteError, {
        inviteId: args.inviteId,
        error: `network: ${message}`,
      });
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      // 422 typically means the email already has a Clerk account — that's
      // fine, they can just sign in normally and ensureUser will resolve
      // the pending invite. Log and move on.
      console.warn(
        "[clerkInvites] Clerk invite returned",
        res.status,
        text.slice(0, 500),
      );
      await ctx.runMutation(internal.clerkInvites._markInviteError, {
        inviteId: args.inviteId,
        error: `clerk ${res.status}: ${text.slice(0, 300)}`,
      });
      return;
    }

    const payload = (await res.json()) as { id?: string };
    if (!payload.id) {
      console.warn("[clerkInvites] Clerk response missing id", payload);
      return;
    }
    await ctx.runMutation(internal.clerkInvites._markInviteSent, {
      inviteId: args.inviteId,
      clerkInvitationId: payload.id,
    });
  },
});

// ---- Team invite variant ----------------------------------------------

export const sendTeamInviteEmail = internalAction({
  args: { inviteId: v.id("team_invites") },
  handler: async (ctx, args) => {
    const invite = await ctx.runQuery(
      internal.clerkInvites._getTeamInvite,
      { inviteId: args.inviteId },
    );
    if (!invite) return;
    if (invite.status !== "pending") return;
    if (invite.clerkInvitationId) return;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      console.warn(
        "[clerkInvites] CLERK_SECRET_KEY not set; skipping team invite email",
        args.inviteId,
      );
      await ctx.runMutation(internal.clerkInvites._markTeamInviteError, {
        inviteId: args.inviteId,
        error: "CLERK_SECRET_KEY not configured",
      });
      return;
    }

    const appUrl = process.env.APP_URL ?? "http://localhost:3011";
    const redirectUrl = `${appUrl.replace(/\/$/, "")}/customers`;

    let res: Response;
    try {
      res = await fetch("https://api.clerk.com/v1/invitations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address: invite.email,
          redirect_url: redirectUrl,
          public_metadata: {
            cockpit_kind: "team_invite",
            workspaceId: invite.workspaceId,
          },
          notify: true,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[clerkInvites] team invite network error:", message);
      await ctx.runMutation(internal.clerkInvites._markTeamInviteError, {
        inviteId: args.inviteId,
        error: `network: ${message}`,
      });
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      console.warn(
        "[clerkInvites] team invite returned",
        res.status,
        text.slice(0, 500),
      );
      await ctx.runMutation(internal.clerkInvites._markTeamInviteError, {
        inviteId: args.inviteId,
        error: `clerk ${res.status}: ${text.slice(0, 300)}`,
      });
      return;
    }

    const payload = (await res.json()) as { id?: string };
    if (!payload.id) return;
    await ctx.runMutation(internal.clerkInvites._markTeamInviteSent, {
      inviteId: args.inviteId,
      clerkInvitationId: payload.id,
    });
  },
});
