import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  canActInWorkspace,
  canSeeCustomer,
  getActor,
  isClient,
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
    /** Tasks referenced via #task chips. Must belong to this thread's customer. */
    taskRefs: v.optional(v.array(v.id("tasks"))),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");

    if (thread.customerId) {
      // Customer-scoped thread: access derives from the customer (firm members
      // via workspace, clients via customer_access). The workspace check below
      // would wrongly reject clients, who have no workspace context.
      if (!(await canSeeCustomer(ctx, actor, thread.customerId))) {
        throw new Error("No access to this thread");
      }
      if (isClient(actor) && thread.audience !== "client") {
        throw new Error("Clients can't post to internal threads");
      }
    } else if (!canActInWorkspace(actor, thread.workspaceId)) {
      // Team-scoped threads (future): require workspace membership.
      throw new Error("No access to this workspace");
    }

    const text = args.text.trim();
    if (!text) throw new Error("Message cannot be empty");
    if (text.length > 10_000) throw new Error("Message too long");

    // Validate taskRefs: must belong to the thread's customer, no duplicates,
    // and (for clients) only clientVisible tasks can be referenced.
    let taskRefs: Id<"tasks">[] | undefined;
    if (args.taskRefs && args.taskRefs.length > 0) {
      if (args.taskRefs.length > 10) {
        throw new Error("Too many task references (max 10)");
      }
      if (!thread.customerId) {
        throw new Error("Task references require a customer-scoped thread");
      }
      const unique = Array.from(new Set(args.taskRefs));
      const tasks = await Promise.all(unique.map((id) => ctx.db.get(id)));
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t) throw new Error("Referenced task not found");
        if (t.customerId !== thread.customerId) {
          throw new Error("Referenced task belongs to a different customer");
        }
        if (isClient(actor) && !t.clientVisible) {
          throw new Error("Cannot reference a non-client-visible task");
        }
      }
      taskRefs = unique;
    }

    const messageId = await ctx.db.insert("messages", {
      threadId: args.threadId,
      workspaceId: thread.workspaceId,
      authorId: actor.userId,
      kind: "text",
      text,
      taskRefs,
    });

    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() });

    return messageId;
  },
});

/**
 * Cross-customer overview of shared (client) thread activity for the firm.
 * Returns one row per customer's shared thread that has any messages,
 * ordered by most recent first. Each row carries the last message's
 * preview so the firm can scan recent client conversations at a glance.
 */
export const listRecentSharedAcrossWorkspace = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor || actor.kind === "client") return [];
    const workspaceId =
      actor.kind === "member"
        ? actor.workspaceId
        : actor.kind === "superadmin"
          ? actor.activeWorkspaceId
          : null;
    if (!workspaceId) return [];

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_workspace_and_scope", (q) =>
        q.eq("workspaceId", workspaceId).eq("scope", "customer"),
      )
      .take(500);

    const sharedThreads = threads.filter(
      (t) => t.audience === "client" && t.lastMessageAt !== undefined,
    );
    sharedThreads.sort(
      (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
    );
    const top = sharedThreads.slice(0, args.limit ?? 25);

    const rows = await Promise.all(
      top.map(async (t) => {
        const lastMessages = await ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .order("desc")
          .take(1);
        const last = lastMessages[0];
        const customer = t.customerId
          ? await ctx.db.get(t.customerId)
          : null;
        const sender = last ? await ctx.db.get(last.authorId) : null;
        return {
          threadId: t._id,
          customerId: t.customerId,
          customerName: customer?.name ?? null,
          lastMessageAt: t.lastMessageAt ?? 0,
          last: last
            ? {
                id: last._id,
                kind: last.kind,
                text: last.text ?? null,
                cardType: last.cardType ?? null,
                createdAt: last._creationTime,
                senderName: sender?.displayName ?? null,
                senderKind: sender?.kind ?? null,
              }
            : null,
        };
      }),
    );

    return rows.filter((r) => r.customerId !== null);
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

    // Enrich with referenced-task info so the UI can render clickable chips.
    const taskIds = Array.from(
      new Set(messages.flatMap((m) => m.taskRefs ?? [])),
    );
    const taskDocs = await Promise.all(taskIds.map((id) => ctx.db.get(id)));
    const taskMap = new Map<
      Id<"tasks">,
      { title: string; status: string; customerId: Id<"customers"> }
    >();
    for (const t of taskDocs) {
      if (!t) continue;
      // Hide non-client-visible tasks from clients in the chip metadata.
      if (isClient(actor) && !t.clientVisible) continue;
      taskMap.set(t._id, {
        title: t.title,
        status: t.status,
        customerId: t.customerId,
      });
    }

    return messages.map((m) => ({
      ...m,
      sender: senderMap.get(m.authorId) ?? null,
      taskRefDetails: (m.taskRefs ?? [])
        .map((id) => {
          const info = taskMap.get(id);
          if (!info) return null;
          return { id, ...info };
        })
        .filter(<T>(x: T | null): x is T => x !== null),
    }));
  },
});
