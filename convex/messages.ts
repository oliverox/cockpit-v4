import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canActInWorkspace,
  canSeeCustomer,
  getActor,
  isClient,
  isSuperadmin,
  tryGetActor,
} from "./lib/auth";

/**
 * Messages — text content posted to a thread.
 *
 * Phase 1.4 ships text only. card / system kinds come with modules; mentions,
 * attachments, edit/delete come with later polish.
 */

export const send = mutation({
  args: {
    threadId: v.id("threads"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");

    if (!canActInWorkspace(actor, thread.workspaceId)) {
      throw new Error("No access to this workspace");
    }

    // Customer threads: derive access from customer
    if (thread.customerId) {
      if (!(await canSeeCustomer(ctx, actor, thread.customerId))) {
        throw new Error("No access to this thread");
      }
      if (isClient(actor) && thread.audience !== "client") {
        throw new Error("Clients can't post to internal threads");
      }
    }

    const text = args.text.trim();
    if (!text) throw new Error("Message cannot be empty");
    if (text.length > 10_000) throw new Error("Message too long");

    const messageId = await ctx.db.insert("messages", {
      threadId: args.threadId,
      workspaceId: thread.workspaceId,
      authorId: actor.userId,
      kind: "text",
      text,
    });

    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });

    return messageId;
  },
});

/**
 * List messages in a thread with sender info attached.
 * Caps at 500 messages for now (Phase 1.4 — pagination later).
 */
export const listByThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];

    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];

    if (thread.customerId) {
      if (!(await canSeeCustomer(ctx, actor, thread.customerId))) return [];
      if (isClient(actor) && thread.audience !== "client") return [];
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .take(500);

    // Enrich with sender info (small fields only).
    const senderIds = Array.from(new Set(messages.map((m) => m.authorId)));
    const senders = await Promise.all(
      senderIds.map((id) => ctx.db.get(id)),
    );
    const senderMap = new Map<
      Id<"users">,
      { displayName: string; avatarUrl: string | null; kind: "human" | "ai" }
    >();
    for (const s of senders) {
      if (!s) continue;
      senderMap.set(s._id, {
        displayName: s.displayName,
        avatarUrl: s.avatarUrl ?? null,
        kind: s.kind,
      });
    }

    return messages.map((m) => ({
      ...m,
      sender: senderMap.get(m.authorId) ?? null,
    }));
  },
});
