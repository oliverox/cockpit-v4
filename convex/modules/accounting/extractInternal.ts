import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
import {
  getActor,
  isClient,
  canActInWorkspace,
  canSeeCustomer,
} from "../../lib/auth";

/**
 * Auth + audit surface for the AI PDF extractor (Phase 3c). The extractor lives
 * in a "use node" action (extract.ts) which can't touch the DB directly, so it
 * calls these via ctx.runQuery / ctx.runMutation (which inherit the caller's
 * identity):
 *
 *   • gateExtract — authorize the (paid, external-API) extraction BEFORE it
 *     runs, so a non-member can never burn API budget. Firm members only.
 *   • logExtraction — record token usage per extraction for cost visibility.
 */

export const gateExtract = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    if (isClient(actor)) throw new Error("Not authorized.");
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    if (!canActInWorkspace(actor, task.workspaceId)) {
      throw new Error("Not authorized for this workspace.");
    }
    if (!(await canSeeCustomer(ctx, actor, task.customerId))) {
      throw new Error("Not authorized for this customer.");
    }
    if (task.type !== "accounting.bank_rec") {
      throw new Error("Extraction is only for bank-reconciliation tasks.");
    }
    if (task.status !== "draft" && task.status !== "review") {
      throw new Error("This task is no longer editable.");
    }

    // Coarse cost guard: cap successful extractions per workspace per hour, so
    // a careless/compromised member can't burn unbounded API spend. Counts the
    // audit rows logExtraction writes (by_workspace index, _creationTime range).
    const HOURLY_CAP = 100;
    const cutoff = Date.now() - 60 * 60 * 1000;
    const recent = await ctx.db
      .query("audit_log")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", task.workspaceId).gt("_creationTime", cutoff),
      )
      .collect();
    const extractions = recent.filter(
      (r) => r.subjectTable === "accounting_pdf_extraction",
    ).length;
    if (extractions >= HOURLY_CAP) {
      throw new Error(
        "Hourly PDF-extraction limit reached for this workspace — try again later or import a CSV.",
      );
    }

    return {
      workspaceId: task.workspaceId,
      customerId: task.customerId,
      actorId: actor.userId,
    };
  },
});

export const logExtraction = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    taskId: v.id("tasks"),
    actorId: v.id("users"),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    lineCount: v.number(),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("audit_log", {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      subjectKind: "substrate",
      subjectTable: "accounting_pdf_extraction",
      subjectId: String(args.taskId),
      action: "create",
      after: {
        model: args.model,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        lineCount: args.lineCount,
        fileName: args.fileName,
      },
    });
  },
});
