import { v } from "convex/values";
import {
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  getActor,
  isClient,
  canActInWorkspace,
  canSeeCustomer,
} from "../../lib/auth";
import { round2 } from "../../../modules/accounting/lib/journal-entry";
import {
  effectiveMatchGroups,
  type BankRecPayload,
} from "../../../modules/accounting/lib/bank-statement";

/**
 * Non-node companions to the AI-matching action (match.ts), mirroring the
 * extract gate pair. Actions have no ctx.db/getActor, so they authorize, read
 * inputs, reserve a cost slot, and persist results through these internal
 * functions, which inherit the action caller's Clerk identity via
 * ctx.runQuery/runMutation.
 */

/** Opus matching is ~5× the cost of extraction — cap tighter than extraction. */
const HOURLY_CAP = 30;

/**
 * Firm-only-editable-bank-rec gate, inlined per function (matching the
 * extractInternal style). Rejects clients/non-members, scopes to the customer,
 * and requires an editable bank-rec task. Returns the resolved actor + task.
 */
async function authEditableBankRec(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
) {
  const actor = await getActor(ctx);
  if (isClient(actor)) throw new Error("Not authorized.");
  const task = await ctx.db.get(taskId);
  if (!task) throw new Error("Task not found.");
  if (!canActInWorkspace(actor, task.workspaceId)) {
    throw new Error("Not authorized for this workspace.");
  }
  if (!(await canSeeCustomer(ctx, actor, task.customerId))) {
    throw new Error("Not authorized for this customer.");
  }
  if (task.type !== "accounting.bank_rec") {
    throw new Error("AI matching is only for bank-reconciliation tasks.");
  }
  if (task.status !== "draft" && task.status !== "review") {
    throw new Error("This task is no longer editable.");
  }
  return { actor, task };
}

type Candidate = {
  id: string;
  date: number;
  description: string;
  /** Signed: positive = inflow, negative = outflow. */
  amount: number;
};

// Bound the work + prompt size. READ_CAP bounds the ledger scan (the contra
// account keeps reconciled history forever); the read is newest-first so the
// cap favours recent entries. CANDIDATE_CAP / BANK_CAP bound the Opus prompt.
const READ_CAP = 4000;
const CANDIDATE_CAP = 800;
const BANK_CAP = 800;

/**
 * The authoritative inputs for an AI match: the still-unmatched bank lines, and
 * the ledger candidates. In Mode B the candidates are the customer's REAL
 * unreconciled ledger entries on the bank's contra account (their `_id`s are
 * the ids the model returns, so the action can trust they exist); in Mode A the
 * candidates are the payload's cashbook lines. Authorizes (this is the action's
 * first call) and bounds every read so a long-lived account can't hard-fail the
 * query or blow up the prompt.
 */
export const getMatchInputs = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { task } = await authEditableBankRec(ctx, args.taskId);
    const payload = (task.payload ?? {}) as BankRecPayload;
    const lines = (payload.lines ?? []).filter((l) => l.signedAmount !== 0);

    // Don't re-offer anything already matched (legacy matches ∪ matchGroups).
    const existing = effectiveMatchGroups(payload);
    const matchedBank = new Set(existing.flatMap((g) => g.bankRowHashes));
    const matchedLedger = new Set(existing.flatMap((g) => g.ledgerRefs));

    let bankUnmatched: Candidate[] = lines
      // Already-categorized lines (post as new) are resolved — don't offer them
      // to the model, or it could match a line the user meant to post as new.
      .filter((l) => !matchedBank.has(l.rowHash) && !l.accountCode)
      .map((l) => ({
        id: l.rowHash,
        date: l.date,
        description: l.description,
        amount: l.signedAmount,
      }));
    let bankCapped = false;
    if (bankUnmatched.length > BANK_CAP) {
      bankUnmatched = bankUnmatched.slice(0, BANK_CAP);
      bankCapped = true;
    }

    let ledgerCandidates: Candidate[] = [];
    let candidateCapped = false;

    if (payload.ledgerSource === "cashbook") {
      ledgerCandidates = (payload.ledgerTxns ?? [])
        .filter((t) => !matchedLedger.has(t.id))
        .map((t) => ({
          id: t.id,
          date: t.date,
          description: t.description,
          amount: t.signedAmount,
        }));
    } else if (payload.bankAccountId) {
      const bank = await ctx.db.get(
        payload.bankAccountId as Id<"accounting_bank_accounts">,
      );
      if (bank && bank.customerId === task.customerId) {
        const contraCode = bank.ledgerAccountCode;
        // Newest-first + bounded: the contra account accumulates reconciled
        // history forever, so cap the scan and favour recent entries (most
        // likely to match a recent statement) rather than the oldest.
        const rows = await ctx.db
          .query("accounting_ledger_entries")
          .withIndex("by_customer_and_account", (q) =>
            q.eq("customerId", task.customerId).eq("accountCode", contraCode),
          )
          .order("desc")
          .take(READ_CAP);
        ledgerCandidates = rows
          .filter(
            (e) =>
              e.reconciliationStatus === "unreconciled" &&
              !matchedLedger.has(e._id),
          )
          .map((e) => ({
            id: e._id,
            date: e.date,
            description: e.description,
            amount: round2(e.debit - e.credit),
          }));
      }
    }

    if (ledgerCandidates.length > CANDIDATE_CAP) {
      ledgerCandidates = ledgerCandidates.slice(0, CANDIDATE_CAP);
      candidateCapped = true;
    }

    return {
      bankUnmatched,
      ledgerCandidates,
      candidateCapped,
      bankCapped,
      ledgerSource: payload.ledgerSource ?? "existing",
    };
  },
});

/**
 * Reserve a cost slot for ONE paid Opus call, atomically. Authorizes, counts
 * this workspace's AI-match audit rows in the last hour, throws if at the cap,
 * and inserts the audit row BEFORE the spend — so the count includes failed-
 * but-paid calls (refusal / parse error / mid-run post race), and concurrent
 * reservations are OCC-serialized on the by_workspace range (a burst can't slip
 * the cap). Returns the audit row id; the action patches it with token usage on
 * success (recordMatchUsage).
 */
export const reserveMatch = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { actor, task } = await authEditableBankRec(ctx, args.taskId);

    const cutoff = Date.now() - 60 * 60 * 1000;
    const recent = await ctx.db
      .query("audit_log")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", task.workspaceId).gt("_creationTime", cutoff),
      )
      .collect();
    const runs = recent.filter(
      (r) => r.subjectTable === "accounting_ai_match",
    ).length;
    if (runs >= HOURLY_CAP) {
      throw new Error(
        "Hourly AI auto-match limit reached for this workspace — match manually or try again later.",
      );
    }

    const auditId = await ctx.db.insert("audit_log", {
      workspaceId: task.workspaceId,
      actorId: actor.userId,
      subjectKind: "substrate",
      subjectTable: "accounting_ai_match",
      subjectId: String(args.taskId),
      action: "create",
      after: {
        status: "attempt",
        model: null,
        inputTokens: null,
        outputTokens: null,
        groupCount: null,
      },
    });
    return { auditId };
  },
});

/** Fill a reserved AI-match audit row with the model + token usage on success. */
export const recordMatchUsage = internalMutation({
  args: {
    auditId: v.id("audit_log"),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    groupCount: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.auditId);
    if (!row) return;
    await ctx.db.patch(args.auditId, {
      after: {
        status: "done",
        model: args.model,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        groupCount: args.groupCount,
      },
    });
  },
});

const matchGroupValidator = v.object({
  groupId: v.string(),
  bankRowHashes: v.array(v.string()),
  ledgerRefs: v.array(v.string()),
  source: v.union(v.literal("exact"), v.literal("manual"), v.literal("ai")),
  confidence: v.optional(v.union(v.literal("exact"), v.literal("probable"))),
  reason: v.optional(v.string()),
});

/**
 * Persist the AI's (already server-validated) match groups onto the task
 * payload. Re-authorizes + re-reads the latest task (the action ran Opus for
 * seconds meanwhile), refuses to write anything but a draft/review task (never
 * bypasses tasks.update's posted-task guard), and MERGES: keeps every manual /
 * exact group + legacy match, replaces the previous AI run, and drops any AI
 * group colliding with an existing claim. Patches only matchGroups + aiMatch,
 * never `lines` — so it can't clobber a concurrent renderer edit.
 */
export const saveMatchResult = internalMutation({
  args: {
    taskId: v.id("tasks"),
    groups: v.array(matchGroupValidator),
    meta: v.object({
      ranAt: v.number(),
      model: v.string(),
      groupCount: v.number(),
      unmatchedBank: v.number(),
      unmatchedLedger: v.number(),
      truncated: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const { task } = await authEditableBankRec(ctx, args.taskId);
    const payload = (task.payload ?? {}) as BankRecPayload;

    // Keep ALL existing groups (manual/exact AND prior AI runs accumulate), then
    // add this run's AI groups that don't collide with an existing claim or a
    // legacy 1:1 match. getMatchInputs already excludes matched lines, so a
    // re-run finds NEW matches without dropping earlier ones.
    const existing = payload.matchGroups ?? [];
    const claimedBank = new Set(existing.flatMap((g) => g.bankRowHashes));
    const claimedLedger = new Set(existing.flatMap((g) => g.ledgerRefs));
    for (const m of payload.matches ?? []) {
      claimedBank.add(m.rowHash);
      claimedLedger.add(m.ledgerEntryId);
    }

    const aiGroups = args.groups.filter(
      (g) =>
        g.bankRowHashes.every((h) => !claimedBank.has(h)) &&
        g.ledgerRefs.every((r) => !claimedLedger.has(r)),
    );
    const matchGroups = [...existing, ...aiGroups];

    await ctx.db.patch(args.taskId, {
      payload: { ...payload, matchGroups, aiMatch: args.meta },
    });
    // Return the merged set so the action can hand it straight back to the
    // renderer (closes the adopt-via-reactive-effect lost-update window).
    return { saved: aiGroups.length, matchGroups };
  },
});
