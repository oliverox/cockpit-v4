import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canActInWorkspace,
  canManageTeam,
  canSeeCustomer,
  getActor,
  isSuperadmin,
  tryGetActor,
} from "./lib/auth";

/**
 * Tasks — the generic envelope every module's work fits into.
 *
 *   • `type` is a string like "core.todo" or "accounting.bank_rec".
 *     The module owning that type provides the renderer and lifecycle rules.
 *   • `payload` is the type-specific draft state — opaque here.
 *   • `status` is universal across types. Each type's manifest declares
 *     which subset of statuses it uses (validated client-side; server
 *     enforces only the universal transitions for now).
 */

const taskStatusValidator = v.union(
  v.literal("draft"),
  v.literal("blocked"),
  v.literal("ingesting"),
  v.literal("processing"),
  v.literal("review"),
  v.literal("firm_approved"),
  v.literal("filed"),
  v.literal("superseded"),
  v.literal("cancelled"),
);

// ---- Create ------------------------------------------------------------

export const create = mutation({
  args: {
    customerId: v.id("customers"),
    moduleId: v.string(),
    type: v.string(),
    title: v.string(),
    payload: v.optional(v.any()),
    assignedTo: v.optional(v.id("users")),
    dueDate: v.optional(v.number()),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) {
      throw new Error("No access to this customer");
    }
    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("No active workspace");
    }

    const title = args.title.trim().slice(0, 300) || "Untitled";

    const taskId = await ctx.db.insert("tasks", {
      workspaceId: customer.workspaceId,
      customerId: args.customerId,
      moduleId: args.moduleId,
      type: args.type,
      status: "draft",
      title,
      assignedTo: args.assignedTo,
      createdBy: actor.userId,
      dueDate: args.dueDate,
      clientVisible: args.clientVisible ?? false,
      payload: args.payload ?? {},
      blockedBy: [],
    });

    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "task",
      subjectTable: "tasks",
      subjectId: taskId,
      action: "create",
      after: { type: args.type, title, status: "draft" },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return taskId;
  },
});

// ---- Read --------------------------------------------------------------

export const get = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return null;
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    if (!(await canSeeCustomer(ctx, actor, task.customerId))) return null;
    if (actor.kind === "client" && !task.clientVisible) return null;
    return task;
  },
});

export const listByCustomer = query({
  args: {
    customerId: v.id("customers"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return [];
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) return [];

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace_and_customer", (q) =>
        q
          .eq("workspaceId", customer.workspaceId)
          .eq("customerId", args.customerId),
      )
      .order("desc")
      .take(500);

    const visible = tasks.filter((t) =>
      args.includeArchived === true ? true : t.status !== "cancelled",
    );

    // Clients only see tasks flagged clientVisible.
    if (actor.kind === "client") {
      return visible.filter((t) => t.clientVisible);
    }
    return visible;
  },
});

// ---- Update ------------------------------------------------------------

export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    payload: v.optional(v.any()),
    assignedTo: v.optional(v.union(v.id("users"), v.null())),
    dueDate: v.optional(v.union(v.number(), v.null())),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (!canActInWorkspace(actor, task.workspaceId)) {
      throw new Error("No access to this task");
    }

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) {
      const next = args.title.trim().slice(0, 300);
      if (!next) throw new Error("Title cannot be empty");
      patch.title = next;
    }
    if (args.payload !== undefined) patch.payload = args.payload;
    if (args.assignedTo !== undefined) {
      patch.assignedTo = args.assignedTo ?? undefined;
    }
    if (args.dueDate !== undefined) {
      patch.dueDate = args.dueDate ?? undefined;
    }
    if (args.clientVisible !== undefined) {
      patch.clientVisible = args.clientVisible;
    }

    if (Object.keys(patch).length === 0) return args.taskId;

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      before[key] = (task as unknown as Record<string, unknown>)[key];
    }

    await ctx.db.patch(args.taskId, patch);

    await ctx.db.insert("audit_log", {
      workspaceId: task.workspaceId,
      actorId: actor.userId,
      subjectKind: "task",
      subjectTable: "tasks",
      subjectId: args.taskId,
      action: "update",
      before,
      after: patch,
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.taskId;
  },
});

// ---- Status transitions -----------------------------------------------

/**
 * Allowed transitions. Universal rules:
 *   • Anything can go to "cancelled" (except already terminal ones,
 *     handled per-type by guardrails — see module manifests).
 *   • draft ↔ review
 *   • review → firm_approved (the canonical approval step)
 *   • firm_approved → review (only via reopen, see `reopen` below)
 *
 * Module-specific extensions (filed, superseded, processing, …) get
 * dedicated mutations later. For Phase 1.3 the four core task types
 * only need draft, review, firm_approved, cancelled.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["review", "firm_approved", "cancelled"],
  blocked: ["draft", "cancelled"],
  review: ["draft", "firm_approved", "cancelled"],
  firm_approved: ["review", "cancelled"], // reopen
  filed: [], // hard terminal — corrections via amendment task
  superseded: [],
  cancelled: ["draft"], // un-cancel
  ingesting: ["draft", "processing", "cancelled"],
  processing: ["review", "cancelled"],
};

export const setStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: taskStatusValidator,
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (!canActInWorkspace(actor, task.workspaceId)) {
      throw new Error("No access to this task");
    }

    if (task.status === args.status) return args.taskId;

    const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(args.status)) {
      throw new Error(
        `Cannot transition task from ${task.status} to ${args.status}`,
      );
    }

    // Reopening (firm_approved → review) requires admin
    if (
      task.status === "firm_approved" &&
      args.status === "review" &&
      !canManageTeam(actor)
    ) {
      throw new Error("Only admins can reopen approved tasks");
    }

    await ctx.db.patch(args.taskId, { status: args.status });

    await ctx.db.insert("audit_log", {
      workspaceId: task.workspaceId,
      actorId: actor.userId,
      subjectKind: "task",
      subjectTable: "tasks",
      subjectId: args.taskId,
      action: deriveAction(task.status, args.status),
      before: { status: task.status },
      after: { status: args.status },
      reason: args.reason,
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.taskId;
  },
});

function deriveAction(from: string, to: string) {
  if (to === "firm_approved") return "approve" as const;
  if (from === "firm_approved" && to === "review") return "reopen" as const;
  if (to === "filed") return "file" as const;
  return "update" as const;
}

// ---- Archive (uses status "cancelled") --------------------------------

export const archive = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (!canActInWorkspace(actor, task.workspaceId)) {
      throw new Error("No access");
    }
    if (task.status === "cancelled") return args.taskId;

    const before = { status: task.status };
    await ctx.db.patch(args.taskId, { status: "cancelled" });

    await ctx.db.insert("audit_log", {
      workspaceId: task.workspaceId,
      actorId: actor.userId,
      subjectKind: "task",
      subjectTable: "tasks",
      subjectId: args.taskId,
      action: "update",
      before,
      after: { status: "cancelled" },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.taskId;
  },
});

// ---- Counts (for the customer dashboard, later) -----------------------

export const countOpenByCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return 0;
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return 0;
    if (!(await canSeeCustomer(ctx, actor, args.customerId))) return 0;

    // Bounded scan; for huge tables we'd maintain a denormalized counter.
    const all = await ctx.db
      .query("tasks")
      .withIndex("by_workspace_and_customer", (q) =>
        q
          .eq("workspaceId", customer.workspaceId)
          .eq("customerId", args.customerId),
      )
      .take(500);
    return all.filter(
      (t) => t.status !== "cancelled" && t.status !== "firm_approved",
    ).length;
  },
});
