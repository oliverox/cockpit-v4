"use node";

import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { round2 } from "../../../modules/accounting/lib/journal-entry";
import {
  parseMatchJson,
  type MatchGroup,
} from "../../../modules/accounting/lib/bank-statement";

/**
 * AI auto-match (Phase 3d). A "use node" action that ports cockpit-v3's Opus
 * `reconcileRemaining`: take the still-unmatched bank lines + ledger candidates,
 * ask Claude to match them (Mauritian bank-pattern recognition + splits), then
 * RE-VALIDATE every proposal server-side before saving. The model never flips a
 * ledger entry directly — it only proposes; finalize's assertions remain the
 * authority. Gated + cost-capped (gateMatch) BEFORE the paid call runs.
 */

// v3's reconciliation/matching tier — Opus, current pricing.
const MODEL = "claude-opus-4-6";
const MAX_OUTPUT_TOKENS = 16384;

function fmtDate(ts: number): string {
  // Statement dates are UTC-noon timestamps; emit YYYY-MM-DD for the prompt.
  return new Date(ts).toISOString().slice(0, 10);
}

function buildPrompt(
  bank: { id: string; date: number; description: string; amount: number }[],
  ledger: { id: string; date: number; description: string; amount: number }[],
): string {
  const shape = (
    xs: { id: string; date: number; description: string; amount: number }[],
  ) =>
    JSON.stringify(
      xs.map((x) => ({
        id: x.id,
        date: fmtDate(x.date),
        description: x.description,
        amount: x.amount,
      })),
      null,
      1,
    );

  return `You are a bank reconciliation expert. Match unmatched transactions between a bank statement and a ledger.

Each transaction has a unique "id" field. Return matches using these IDs. Amounts are signed: negative = money out (outflow), positive = money in (inflow). Dates are YYYY-MM-DD.

BANK TRANSACTIONS (${bank.length} unmatched):
${shape(bank)}

LEDGER TRANSACTIONS (${ledger.length} unmatched):
${shape(ledger)}

Return a JSON object with this EXACT structure:
{
  "matches": [
    { "bankIds": ["bank-id-1"], "ledgerIds": ["ledger-id-1"], "confidence": "exact", "notes": "Exact match" },
    { "bankIds": ["bank-id-2"], "ledgerIds": ["ledger-id-3", "ledger-id-4"], "confidence": "probable", "notes": "Split: one deposit = sum of multiple ledger entries" }
  ],
  "unmatchedBankIds": ["bank-id-5"],
  "unmatchedLedgerIds": ["ledger-id-7"],
  "errors": []
}

Rules:
- Match by amount (sign-agnostic, within 0.02 tolerance) AND consistent direction.
- Allow date differences of 1-3 days (posting delays).
- Match even with different descriptions — bank statements use cryptic codes while ledgers use human-readable names.
- Handle splits: one bank entry = multiple ledger entries (or vice versa). A single "CASH DEPOSIT" at a branch may aggregate many individual ledger receipts deposited together — sum ledger entries from around the same date to match. For ANY split, the bank-side total MUST equal the ledger-side total.
- "CROSS CCY RECEIPT" entries are foreign-currency deposits — match to ledger entries mentioning USD, GBP, CHF, EUR or currency conversions.
- Mauritian utility/bank codes: "CWA" = water, "CEB"/"CEBROD"/"CEBMK" = electricity, "MT" = telecom; "MCBL"/"BARC" = bank transfer with the sender name embedded after the prefix.
- "Bill Payment for [MUR/ xxx]" debits of 6.00/8.00 are bank charges paired with utility payments — match to "Bank Charges" in the ledger.
- For splits, put the multiple IDs in the bankIds or ledgerIds array.
- "errors": flag any data problems you notice (e.g. an amount that looks wrong).
- EVERY unmatched bank/ledger transaction id must appear in either a match or in unmatchedBankIds/unmatchedLedgerIds.
- NEVER invent transaction ids. Use ONLY ids from the data above.
- Return ONLY valid JSON. No code fences, no explanation.`;
}

type AiMatchActionResult = {
  matched: number;
  unmatchedBank: number;
  unmatchedLedger: number;
  truncated: boolean;
  candidateCapped: boolean;
  bankCapped: boolean;
  /** The full merged group set after this run (manual + all AI). Returned so
   *  the renderer adopts it synchronously, not via the reactive effect. */
  groups?: MatchGroup[];
  note?: string;
};

export const aiMatch = action({
  args: { taskId: v.id("tasks") },
  // Explicit return type: this action calls internal.* (which includes itself),
  // so without an annotation the inferred type is circular and resolves to any.
  handler: async (ctx, args): Promise<AiMatchActionResult> => {
    // getMatchInputs authorizes (firm-only, editable bank-rec) before reading.
    const inputs = await ctx.runQuery(
      internal.modules.accounting.matchInternal.getMatchInputs,
      { taskId: args.taskId },
    );

    if (inputs.bankUnmatched.length === 0 || inputs.ledgerCandidates.length === 0) {
      return {
        matched: 0,
        unmatchedBank: inputs.bankUnmatched.length,
        unmatchedLedger: inputs.ledgerCandidates.length,
        truncated: false,
        candidateCapped: inputs.candidateCapped,
        bankCapped: inputs.bankCapped,
        note: "Nothing left to auto-match.",
      };
    }

    // Reserve a cost slot BEFORE the paid call — atomic per-workspace hourly
    // cap that counts even if the call below fails (refusal / parse error /
    // post race). The id is patched with token usage on success.
    const { auditId } = await ctx.runMutation(
      internal.modules.accounting.matchInternal.reserveMatch,
      { taskId: args.taskId },
    );

    const anthropic = new Anthropic();
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: buildPrompt(inputs.bankUnmatched, inputs.ledgerCandidates),
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error("The model declined to match these transactions.");
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) {
      throw new Error("The model returned no text — try again or match manually.");
    }

    const parsed = parseMatchJson(text);

    // Re-validate every proposal against the inputs we sent — trust nothing.
    const bankById = new Map(inputs.bankUnmatched.map((b) => [b.id, b]));
    const ledgerById = new Map(inputs.ledgerCandidates.map((l) => [l.id, l]));
    const usedBank = new Set<string>();
    const usedLedger = new Set<string>();
    const groups: MatchGroup[] = [];

    parsed.matches.forEach((m, i) => {
      // Existing, not-yet-claimed ids only (drops fabricated / double-used ids).
      const bankIds = [...new Set(m.bankIds)].filter(
        (id) => bankById.has(id) && !usedBank.has(id),
      );
      const ledgerIds = [...new Set(m.ledgerIds)].filter(
        (id) => ledgerById.has(id) && !usedLedger.has(id),
      );
      if (bankIds.length === 0 || ledgerIds.length === 0) return;

      // Bank side and ledger side must net to the same signed amount — the same
      // assertion finalize will re-run, so we never surface a group that can't
      // post.
      const bankSigned = round2(
        bankIds.reduce((s, id) => round2(s + bankById.get(id)!.amount), 0),
      );
      const ledgerSigned = round2(
        ledgerIds.reduce((s, id) => round2(s + ledgerById.get(id)!.amount), 0),
      );
      if (Math.abs(bankSigned - ledgerSigned) > 0.02) return;

      bankIds.forEach((id) => usedBank.add(id));
      ledgerIds.forEach((id) => usedLedger.add(id));
      groups.push({
        groupId: `ai_${args.taskId}_${i}`,
        bankRowHashes: bankIds,
        ledgerRefs: ledgerIds,
        source: "ai",
        confidence: m.confidence,
        reason: m.notes,
      });
    });

    const unmatchedBank = inputs.bankUnmatched.filter(
      (b) => !usedBank.has(b.id),
    ).length;
    const unmatchedLedger = inputs.ledgerCandidates.filter(
      (l) => !usedLedger.has(l.id),
    ).length;
    const truncated = message.stop_reason === "max_tokens";

    const saved = await ctx.runMutation(
      internal.modules.accounting.matchInternal.saveMatchResult,
      {
        taskId: args.taskId,
        groups,
        meta: {
          ranAt: Date.now(),
          model: MODEL,
          groupCount: groups.length,
          unmatchedBank,
          unmatchedLedger,
          truncated,
        },
      },
    );
    await ctx.runMutation(
      internal.modules.accounting.matchInternal.recordMatchUsage,
      {
        auditId,
        model: MODEL,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        groupCount: groups.length,
      },
    );

    return {
      // What was actually persisted (collisions with existing claims dropped).
      matched: saved.saved,
      unmatchedBank,
      unmatchedLedger,
      truncated,
      candidateCapped: inputs.candidateCapped,
      bankCapped: inputs.bankCapped,
      groups: saved.matchGroups,
    };
  },
});
