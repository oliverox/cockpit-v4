import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
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
 * inputs, and persist results through these internal functions, which inherit
 * the action caller's Clerk identity via ctx.runQuery/runMutation.
 */

/**
 * Authorize a paid AI auto-match BEFORE it runs: firm members only (never
 * clients), scoped to the customer, on an editable bank-rec task, under a
 * per-workspace hourly cap. Opus matching is ~5× the cost of extraction, so the
 * cap is tighter. Counts the audit rows logMatch writes.
 */
export const gateMatch = internalQuery({
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
      throw new Error("AI matching is only for bank-reconciliation tasks.");
    }
    if (task.status !== "draft" && task.status !== "review") {
      throw new Error("This task is no longer editable.");
    }

    const HOURLY_CAP = 30;
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

    return {
      workspaceId: task.workspaceId,
      customerId: task.customerId,
      actorId: actor.userId,
    };
  },
});

type Candidate = {
  id: string;
  date: number;
  description: string;
  /** Signed: positive = inflow, negative = outflow. */
  amount: number;
};

/**
 * The authoritative inputs for an AI match: the still-unmatched bank lines, and
 * the ledger candidates. In Mode B the candidates are the customer's REAL
 * unreconciled ledger entries on the bank's contra account (their `_id`s are
 * the ids the model returns, so the action can trust they exist); in Mode A the
 * candidates are the payload's cashbook lines. Capped to bound prompt size.
 */
export const getMatchInputs = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found.");
    const payload = (task.payload ?? {}) as BankRecPayload;
    const lines = (payload.lines ?? []).filter((l) => l.signedAmount !== 0);

    // Don't re-offer anything already matched (legacy matches ∪ matchGroups).
    const existing = effectiveMatchGroups(payload);
    const matchedBank = new Set(existing.flatMap((g) => g.bankRowHashes));
    const matchedLedger = new Set(existing.flatMap((g) => g.ledgerRefs));

    const bankUnmatched: Candidate[] = lines
      .filter((l) => !matchedBank.has(l.rowHash))
      .map((l) => ({
        id: l.rowHash,
        date: l.date,
        description: l.description,
        amount: l.signedAmount,
      }));

    const CANDIDATE_CAP = 800;
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
        const rows = await ctx.db
          .query("accounting_ledger_entries")
          .withIndex("by_customer_and_account", (q) =>
            q.eq("customerId", task.customerId).eq("accountCode", contraCode),
          )
          .collect();
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
      ledgerSource: payload.ledgerSource ?? "existing",
    };
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
      throw new Error("Wrong task type.");
    }
    if (task.status !== "draft" && task.status !== "review") {
      throw new Error("This task is no longer editable.");
    }
    const payload = (task.payload ?? {}) as BankRecPayload;

    // Existing claims that AI groups must not collide with: manual/exact groups
    // and any legacy `matches`.
    const manualGroups = (payload.matchGroups ?? []).filter(
      (g) => g.source !== "ai",
    );
    const claimedBank = new Set(manualGroups.flatMap((g) => g.bankRowHashes));
    const claimedLedger = new Set(manualGroups.flatMap((g) => g.ledgerRefs));
    for (const m of payload.matches ?? []) {
      claimedBank.add(m.rowHash);
      claimedLedger.add(m.ledgerEntryId);
    }

    const aiGroups = args.groups.filter(
      (g) =>
        g.bankRowHashes.every((h) => !claimedBank.has(h)) &&
        g.ledgerRefs.every((r) => !claimedLedger.has(r)),
    );

    await ctx.db.patch(args.taskId, {
      payload: {
        ...payload,
        matchGroups: [...manualGroups, ...aiGroups],
        aiMatch: args.meta,
      },
    });
    return { saved: aiGroups.length };
  },
});

/** Audit a completed AI match (token usage drives the gateMatch hourly cap). */
export const logMatch = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    taskId: v.id("tasks"),
    actorId: v.id("users"),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    groupCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("audit_log", {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      subjectKind: "substrate",
      subjectTable: "accounting_ai_match",
      subjectId: String(args.taskId),
      action: "create",
      after: {
        model: args.model,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        groupCount: args.groupCount,
      },
    });
  },
});
