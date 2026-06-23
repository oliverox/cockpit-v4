import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  postBankStatementToLedger,
  postJournalEntryToLedger,
} from "../modules/accounting/finalize";

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
  "accounting.bank_rec": postBankStatementToLedger,
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
    if (se.kind !== "substrate") continue;
    // refId is the row's _id; the embedded table info lets Convex resolve the
    // delete/patch regardless of the cast's nominal table.
    const ref = se.refId as Id<"accounting_ledger_entries">;
    if (se.op === "create") {
      await ctx.db.delete(ref);
    } else if (se.op === "update") {
      // Restore the pre-approval field values — e.g. a matched ledger entry's
      // reconciliationStatus/reconciliationId (bank-rec matching, Phase 3b).
      // `before` may carry null to mean "field was absent"; translate null →
      // undefined so this TOP-LEVEL patch actually CLEARS the field (Convex
      // drops nested undefined during serialization, so we store null and
      // clear it here).
      const before = (se.before ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(before)) {
        patch[k] = before[k] === null ? undefined : before[k];
      }
      await ctx.db.patch(
        ref,
        patch as Partial<Doc<"accounting_ledger_entries">>,
      );
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
