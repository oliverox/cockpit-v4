import type { GuardrailDef, TaskTypeDef } from "./types";

/**
 * Server-safe module registry.
 *
 * This is the React-FREE half of the module system. Convex functions need a
 * little module data — which task types require an attachment, what the
 * guardrails are — but they must never import `registry.ts` or the manifests,
 * because those carry React components (task renderers, nav icons) that cannot
 * cross the Convex boundary and would drag lucide-react/react into the server
 * bundle.
 *
 * So the *data* half of each module's task types lives here (plain objects),
 * and the *presentation* half (renderers, listItems, nav icons) lives in the
 * manifest, which spreads these defs in. This file is the single source of
 * truth for task-type flags and guardrails; `convex/*` imports only from here.
 */

/** The server-safe slice of a task type (everything except the React bits). */
export type TaskTypeServerDef = Omit<TaskTypeDef, "renderer" | "listItem">;

export const CORE_TASK_TYPES: Record<string, TaskTypeServerDef> = {
  "core.todo": {
    label: "Todo",
    defaultClientVisible: false,
  },
  "core.document_request": {
    label: "Document request",
    defaultClientVisible: true,
    requiresAttachment: true,
  },
  "core.review": {
    label: "Review",
    defaultClientVisible: true,
  },
  "core.meeting": {
    label: "Meeting",
    defaultClientVisible: false,
  },
};

export const CORE_GUARDRAILS: Record<string, GuardrailDef> = {
  "core.todo": {
    statuses: ["draft", "review", "firm_approved", "cancelled"],
    reopenPolicy: { draft: "free", review: "free", firm_approved: "free" },
  },
  "core.document_request": {
    statuses: ["draft", "review", "firm_approved", "cancelled"],
    reopenPolicy: { draft: "free", review: "free", firm_approved: "free" },
  },
  "core.review": {
    statuses: ["draft", "review", "firm_approved", "cancelled"],
    reopenPolicy: {
      draft: "free",
      review: "free",
      firm_approved: { requires: "admin", reason: "optional" },
    },
  },
  "core.meeting": {
    statuses: ["draft", "firm_approved", "cancelled"],
    reopenPolicy: { draft: "free", firm_approved: "free" },
  },
};

export const ACCOUNTING_TASK_TYPES: Record<string, TaskTypeServerDef> = {
  "accounting.journal_entry": {
    label: "Journal entry",
    defaultClientVisible: false,
  },
};

export const ACCOUNTING_GUARDRAILS: Record<string, GuardrailDef> = {
  "accounting.journal_entry": {
    statuses: ["draft", "review", "firm_approved", "cancelled"],
    reopenPolicy: {
      draft: "free",
      review: "free",
      // Reopening unwinds the posted ledger batch — owner-only, reason required.
      firm_approved: { requires: "owner", reason: "required" },
    },
    // Posted ledger lines are period-locked once approved; amend via reopen.
    locks: { "accounting_ledger_entries.*": "period" },
  },
};

// Aggregate across modules. Plain data only — extend when a module adds
// server-relevant task types.
const TASK_TYPE_SERVER_DEFS: Record<string, TaskTypeServerDef> = {
  ...CORE_TASK_TYPES,
  ...ACCOUNTING_TASK_TYPES,
};

const GUARDRAILS: Record<string, GuardrailDef> = {
  ...CORE_GUARDRAILS,
  ...ACCOUNTING_GUARDRAILS,
};

/** Server-safe task-type lookup (flags only — no renderer). */
export function getTaskTypeServerDef(
  type: string,
): TaskTypeServerDef | undefined {
  return TASK_TYPE_SERVER_DEFS[type];
}

/** Server-safe guardrail lookup. */
export function getGuardrailForTaskType(type: string): GuardrailDef | undefined {
  return GUARDRAILS[type];
}
