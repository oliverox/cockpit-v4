import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canActInWorkspace,
  canSeeCustomer,
  getActor,
  isMember,
  isSuperadmin,
  tryGetActor,
} from "./lib/auth";

const eventCategoryValidator = v.union(
  v.literal("deadline"),
  v.literal("meeting"),
  v.literal("reminder"),
  v.literal("milestone"),
  v.literal("custom"),
);

function actorWorkspace(
  actor: Awaited<ReturnType<typeof getActor>>,
): Id<"workspaces"> | null {
  if (isMember(actor)) return actor.workspaceId;
  if (isSuperadmin(actor)) return actor.activeWorkspaceId ?? null;
  return null;
}

// ---- Mutations ---------------------------------------------------------

export const createEvent = mutation({
  args: {
    title: v.string(),
    start: v.number(),
    end: v.optional(v.number()),
    allDay: v.boolean(),
    description: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    category: v.optional(eventCategoryValidator),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const workspaceId = actorWorkspace(actor);
    if (!workspaceId) throw new Error("No active workspace");

    if (args.customerId) {
      if (!(await canSeeCustomer(ctx, actor, args.customerId))) {
        throw new Error("No access to this customer");
      }
    }

    const title = args.title.trim().slice(0, 300) || "Untitled";

    return await ctx.db.insert("calendar_events", {
      workspaceId,
      title,
      description: args.description,
      start: args.start,
      end: args.end,
      allDay: args.allDay,
      customerId: args.customerId,
      assignedTo: [],
      category: args.category ?? "custom",
      source: "manual",
      createdBy: actor.userId,
    });
  },
});

export const deleteEvent = mutation({
  args: { eventId: v.id("calendar_events") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");
    if (!canActInWorkspace(actor, event.workspaceId)) {
      throw new Error("No access");
    }
    if (event.source !== "manual") {
      throw new Error(
        "Module-generated events can't be deleted directly. Remove the source.",
      );
    }
    await ctx.db.delete(args.eventId);
    return null;
  },
});

// ---- Queries -----------------------------------------------------------

type CalendarItem =
  | {
      kind: "event";
      id: Id<"calendar_events">;
      title: string;
      start: number;
      end: number | null;
      allDay: boolean;
      category: Doc<"calendar_events">["category"];
      customerId: Id<"customers"> | null;
      customerName: string | null;
      source: Doc<"calendar_events">["source"];
    }
  | {
      kind: "task";
      id: Id<"tasks">;
      title: string;
      start: number;
      taskType: string;
      status: Doc<"tasks">["status"];
      customerId: Id<"customers"> | null;
      customerName: string | null;
    };

/**
 * Unified upcoming view — manual calendar_events + tasks with dueDate,
 * merged and sorted by date. Includes 7 days into the past for context.
 */
export const upcoming = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args): Promise<CalendarItem[]> => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];
    const workspaceId = isMember(actor)
      ? actor.workspaceId
      : isSuperadmin(actor)
        ? actor.activeWorkspaceId
        : null;
    if (!workspaceId) return [];

    const days = args.days ?? 60;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const from = now - 7 * day;
    const to = now + days * day;

    const events = await ctx.db
      .query("calendar_events")
      .withIndex("by_workspace_and_start", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .gte("start", from)
          .lte("start", to),
      )
      .take(500);

    // Tasks with dueDate in range. We use the by_due_date index then
    // filter by workspace + status.
    const tasksByDue = await ctx.db
      .query("tasks")
      .withIndex("by_due_date", (q) =>
        q.gte("dueDate", from).lte("dueDate", to),
      )
      .take(500);

    const relevantTasks = tasksByDue.filter(
      (t) =>
        t.workspaceId === workspaceId &&
        t.status !== "cancelled" &&
        t.status !== "firm_approved" &&
        t.status !== "filed",
    );

    // Look up customer names in one batch
    const customerIds = new Set<Id<"customers">>();
    for (const e of events) if (e.customerId) customerIds.add(e.customerId);
    for (const t of relevantTasks) customerIds.add(t.customerId);
    const customers = await Promise.all(
      Array.from(customerIds).map((id) => ctx.db.get(id)),
    );
    const customerMap = new Map<Id<"customers">, string>();
    for (const c of customers) if (c) customerMap.set(c._id, c.name);

    const items: CalendarItem[] = [
      ...events.map((e): CalendarItem => ({
        kind: "event",
        id: e._id,
        title: e.title,
        start: e.start,
        end: e.end ?? null,
        allDay: e.allDay,
        category: e.category,
        customerId: e.customerId ?? null,
        customerName: e.customerId
          ? customerMap.get(e.customerId) ?? null
          : null,
        source: e.source,
      })),
      ...relevantTasks.map((t): CalendarItem => ({
        kind: "task",
        id: t._id,
        title: t.title,
        start: t.dueDate!,
        taskType: t.type,
        status: t.status,
        customerId: t.customerId,
        customerName: customerMap.get(t.customerId) ?? null,
      })),
    ];

    items.sort((a, b) => a.start - b.start);
    return items;
  },
});

/** Per-customer calendar — same item shape, filtered to one customer.
 *
 * Client actors see only client-visible tasks and module-generated events
 * (manual firm-internal events are hidden). Firm actors see everything.
 */
export const upcomingForCustomer = query({
  args: { customerId: v.id("customers"), days: v.optional(v.number()) },
  handler: async (ctx, args): Promise<CalendarItem[]> => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) return [];

    const customer = await ctx.db.get(args.customerId);
    if (!customer) return [];

    const days = args.days ?? 60;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const from = now - 7 * day;
    const to = now + days * day;
    const isClientActor = actor.kind === "client";

    const events = await ctx.db
      .query("calendar_events")
      .withIndex("by_customer_and_start", (q) =>
        q
          .eq("customerId", args.customerId)
          .gte("start", from)
          .lte("start", to),
      )
      .take(500);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace_and_customer", (q) =>
        q
          .eq("workspaceId", customer.workspaceId)
          .eq("customerId", args.customerId),
      )
      .take(500);

    const relevantTasks = tasks.filter(
      (t) =>
        t.dueDate !== undefined &&
        t.dueDate >= from &&
        t.dueDate <= to &&
        t.status !== "cancelled" &&
        t.status !== "firm_approved" &&
        t.status !== "filed" &&
        (!isClientActor || t.clientVisible),
    );

    const relevantEvents = events.filter(
      // Manual firm-internal events stay firm-only until we add an explicit
      // visibility flag on calendar_events. Module-generated events ride on
      // their underlying task's visibility.
      (e) => !isClientActor || e.source !== "manual",
    );

    const items: CalendarItem[] = [
      ...relevantEvents.map((e): CalendarItem => ({
        kind: "event",
        id: e._id,
        title: e.title,
        start: e.start,
        end: e.end ?? null,
        allDay: e.allDay,
        category: e.category,
        customerId: e.customerId ?? null,
        customerName: customer.name,
        source: e.source,
      })),
      ...relevantTasks.map((t): CalendarItem => ({
        kind: "task",
        id: t._id,
        title: t.title,
        start: t.dueDate!,
        taskType: t.type,
        status: t.status,
        customerId: t.customerId,
        customerName: customer.name,
      })),
    ];
    items.sort((a, b) => a.start - b.start);
    return items;
  },
});
