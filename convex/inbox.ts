import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { tryGetActor } from "./lib/auth";

/**
 * Inbox — cross-customer aggregator of things waiting on the current user.
 *
 * Phase 1.6 covers tasks (assigned to me, not cancelled/approved/filed)
 * plus tasks I created that are currently in `review`. Mentions, signature
 * requests, connector errors come later as those features land.
 */

type InboxItem = {
  kind: "assigned_task" | "review_pending";
  id: Id<"tasks">;
  title: string;
  status: Doc<"tasks">["status"];
  type: string;
  customerId: Id<"customers">;
  customerName: string | null;
  dueDate: number | null;
  ts: number; // sort key (creation or due date)
};

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx): Promise<InboxItem[]> => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];
    if (actor.kind === "client") return [];

    // Tasks assigned to me, in active states.
    const assigned = await ctx.db
      .query("tasks")
      .withIndex("by_assigned_to_and_status", (q) =>
        q.eq("assignedTo", actor.userId),
      )
      .take(500);

    const activeAssigned = assigned.filter(
      (t) =>
        t.status !== "cancelled" &&
        t.status !== "firm_approved" &&
        t.status !== "filed" &&
        t.status !== "superseded",
    );

    // Tasks I created that are now in review (waiting on someone).
    // No index by createdBy yet — scan via workspace + filter.
    const workspaceId =
      actor.kind === "member"
        ? actor.workspaceId
        : actor.kind === "superadmin"
          ? actor.activeWorkspaceId
          : null;
    let myReviewPending: Doc<"tasks">[] = [];
    if (workspaceId) {
      const allTasks = await ctx.db
        .query("tasks")
        .withIndex("by_workspace_and_customer", (q) =>
          q.eq("workspaceId", workspaceId),
        )
        .take(500);
      myReviewPending = allTasks.filter(
        (t) =>
          t.createdBy === actor.userId &&
          t.status === "review" &&
          t.assignedTo !== actor.userId, // already in assigned bucket otherwise
      );
    }

    // Look up customer names
    const customerIds = new Set<Id<"customers">>();
    for (const t of activeAssigned) customerIds.add(t.customerId);
    for (const t of myReviewPending) customerIds.add(t.customerId);
    const customers = await Promise.all(
      Array.from(customerIds).map((id) => ctx.db.get(id)),
    );
    const customerMap = new Map<Id<"customers">, string>();
    for (const c of customers) if (c) customerMap.set(c._id, c.name);

    const items: InboxItem[] = [
      ...activeAssigned.map((t): InboxItem => ({
        kind: "assigned_task",
        id: t._id,
        title: t.title,
        status: t.status,
        type: t.type,
        customerId: t.customerId,
        customerName: customerMap.get(t.customerId) ?? null,
        dueDate: t.dueDate ?? null,
        ts: t.dueDate ?? t._creationTime,
      })),
      ...myReviewPending.map((t): InboxItem => ({
        kind: "review_pending",
        id: t._id,
        title: t.title,
        status: t.status,
        type: t.type,
        customerId: t.customerId,
        customerName: customerMap.get(t.customerId) ?? null,
        dueDate: t.dueDate ?? null,
        ts: t.dueDate ?? t._creationTime,
      })),
    ];

    // Sort: overdue first, then by due date / creation
    const now = Date.now();
    items.sort((a, b) => {
      const aOver = a.dueDate !== null && a.dueDate < now ? 0 : 1;
      const bOver = b.dueDate !== null && b.dueDate < now ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return a.ts - b.ts;
    });

    return items;
  },
});
