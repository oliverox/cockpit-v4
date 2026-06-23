import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { postJournalEntryToLedger } from "../modules/accounting/finalize";

/**
 * Approval side-effect engine.
 *
 * When a task transitions review → firm_approved, some modules need to commit
 * substrate (e.g. accounting posts a balanced journal entry to the ledger).
 * Those writes are recorded on the `task_approvals` row so reopening the task
 * (firm_approved → review) can reverse them.
 *
 * Core stays module-agnostic: `tasks.setStatus` dispatches through
 * `getFinalizeHandler` / `reverseApproval` here, and modules plug in by adding
 * a line to FINALIZE_HANDLERS — the server-side mirror of the client manifest
 * registry. This file imports module finalize *helpers* (plain functions, no
 * React), never a manifest, so nothing UI crosses the Convex boundary.
 *
 * Finalize handlers are DB-only and run INLINE within setStatus's mutation
 * (not scheduled), so a failure (e.g. an unbalanced entry) rolls back the
 * whole transition — task state and the ledger never diverge.
 */

/** A reversible side-effect — matches the task_approvals.sideEffects shape. */
export type SideEffect = {
  kind: "substrate" | "document" | "card" | "event";
  table?: string;
  refId: string;
  op: "create" | "update";
  before?: unknown;
  after?: unknown;
};

export type FinalizeHandler = (
  ctx: MutationCtx,
  args: { task: Doc<"tasks">; approvedBy: Id<"users"> },
) => Promise<SideEffect[]>;

const FINALIZE_HANDLERS: Record<string, FinalizeHandler> = {
  "accounting.journal_entry": postJournalEntryToLedger,
};

export function getFinalizeHandler(
  taskType: string,
): FinalizeHandler | undefined {
  return FINALIZE_HANDLERS[taskType];
}

/**
 * Reverse the most-recent un-reversed approval of a task: delete every
 * `create` substrate row it produced, then stamp the approval reversed.
 * Generic across modules. Runs inline within the reopen mutation.
 */
export async function reverseApproval(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  reversedBy: Id<"users">,
): Promise<void> {
  const approvals = await ctx.db
    .query("task_approvals")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .order("desc")
    .collect();
  const latest = approvals.find((a) => a.reversedAt === undefined);
  if (!latest) return;

  for (const se of latest.sideEffects) {
    if (se.op === "create" && se.kind === "substrate") {
      // refId is the created row's _id; the embedded table info lets Convex
      // resolve the delete regardless of the cast's nominal table.
      await ctx.db.delete(se.refId as Id<"accounting_ledger_entries">);
    }
  }

  await ctx.db.patch(latest._id, {
    reversedAt: Date.now(),
    reversedBy,
  });

  await ctx.db.insert("audit_log", {
    workspaceId: task.workspaceId,
    actorId: reversedBy,
    subjectKind: "task",
    subjectTable: "task_approvals",
    subjectId: latest._id,
    action: "reopen",
    before: { reversedSideEffects: latest.sideEffects.length },
  });
}
