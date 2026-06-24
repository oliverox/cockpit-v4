"use node";

import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { createHash } from "crypto";
import {
  parseExtractionJson,
  mapExtractedToLines,
} from "../../../modules/accounting/lib/bank-statement";

/**
 * AI PDF bank-statement extraction (Phase 3c). A "use node" Convex action that
 * mirrors cockpit-v3's extractor: read the uploaded PDF from storage, send it to
 * Claude as a base64 `document` block with the bank-statement extraction prompt,
 * stream the response, parse the JSON, and map it to v4 StatementLine[]. Invoked
 * synchronously from the bank-rec renderer (useAction); returns lines + the
 * statement's metadata (bank, currency, period, opening/closing balance) for the
 * client to persist into the task payload.
 *
 * The paid model call is gated by gateExtract BEFORE any request runs, and token
 * usage is logged afterwards for cost visibility.
 */

// v3's extraction model — current (not retired), $3/$15 per MTok, the
// cost-appropriate tier for structured extraction. Swap to claude-opus-4-8 for
// maximum accuracy on messy scans.
const MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 32000;
// Guardrail: reject very large PDFs before paying for a request (the API cap is
// 32 MB / 600 pages; this is a tighter cost bound).
const MAX_PDF_BYTES = 15 * 1024 * 1024;

// Ported ~verbatim from cockpit-v3 reconciliationProcessor's EXTRACTION_PROMPT —
// the battle-tested bank-statement → structured-JSON instructions.
const EXTRACTION_PROMPT = `Extract ALL transactions from this document into a JSON object. Return ONLY valid JSON, no explanation.

{
  "openingBalance": 65591.00,
  "closingBalance": 11603.49,
  "currency": "MUR",
  "period": "February 1-28, 2026",
  "accountName": "Main Operating",
  "bankName": "State Bank of Mauritius",
  "transactions": [
    {
      "date": "2026-02-02",
      "description": "Amazon Web Services",
      "amount": -30.24,
      "type": "Card Payment",
      "reference": ""
    }
  ]
}

Rules:
- Dates in YYYY-MM-DD format
- Negative amounts for outflows (money out), positive for inflows (money in)
- Use a single signed "amount" per transaction (never separate debit/credit fields)
- Include ALL transactions - do not skip any
- Extract opening and closing balances if shown; omit the field if not present
- Extract the bank/financial institution name as "bankName" if it is a bank statement (e.g. "State Bank of Mauritius", "MCB", "HSBC")
- Extract the statement currency as a 3-letter code if shown (e.g. "MUR", "USD")
- For DD-Mon-YY dates (e.g. "02-Feb-26"), assume the 20xx century (2026, not 1926)
- Do NOT include running-balance rows or summary/total rows as transactions
- Return ONLY the JSON object. No code fences, no explanation.`;

export const extractStatement = action({
  args: {
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Authorize BEFORE spending on the model.
    const gate = await ctx.runQuery(
      internal.modules.accounting.extractInternal.gateExtract,
      { taskId: args.taskId },
    );

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Uploaded file not found.");
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new Error(
        "PDF is too large to extract (max 15 MB). Split it, or upload a CSV.",
      );
    }
    const base64 = Buffer.from(bytes).toString("base64");
    const fileHash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    // Bytes are in memory now — don't leave the upload orphaned in storage.
    await ctx.storage.delete(args.storageId);

    // Mirrors v3: default client (reads ANTHROPIC_API_KEY from the deployment
    // env), base64 document block + prompt, stream → final message.
    const anthropic = new Anthropic();
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error(
        "The model declined to process this document. Try a clearer scan or import a CSV.",
      );
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) {
      throw new Error("The model returned no text — try again or use CSV.");
    }

    const stmt = parseExtractionJson(text);
    const { lines, skipped } = mapExtractedToLines(stmt);
    if (lines.length === 0) {
      throw new Error(
        "No transactions could be read from this PDF. Try a clearer scan or upload a CSV.",
      );
    }

    await ctx.runMutation(
      internal.modules.accounting.extractInternal.logExtraction,
      {
        workspaceId: gate.workspaceId,
        customerId: gate.customerId,
        taskId: args.taskId,
        actorId: gate.actorId,
        model: MODEL,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        lineCount: lines.length,
        fileName: args.fileName,
      },
    );

    return {
      lines,
      skipped,
      // SHA-256 of the PDF bytes — lets the post-time duplicate-import guard
      // apply to PDFs (re-uploading the same file is blocked).
      fileHash,
      meta: {
        bankName: stmt.bankName,
        currency: stmt.currency,
        period: stmt.period,
        openingBalance: stmt.openingBalance,
        closingBalance: stmt.closingBalance,
      },
      // True if the model hit max_tokens — lines were truncation-repaired and
      // may be incomplete; the renderer warns the user.
      truncated: message.stop_reason === "max_tokens",
    };
  },
});
