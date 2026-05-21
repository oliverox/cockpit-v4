/**
 * Mapping helpers for displaying task status and type to humans.
 * Storage uses the universal taskStatus enum; display is per-task-type.
 */

import type { Doc } from "@/convex/_generated/dataModel";

type Pill =
  | "draft"
  | "blocked"
  | "review"
  | "processing"
  | "completed"
  | "filed"
  | "failed"
  | "neutral";

export type StatusDisplay = {
  label: string;
  pill: Pill;
};

export function statusDisplay(
  status: Doc<"tasks">["status"],
  type: string,
): StatusDisplay {
  // Simple types use friendlier labels.
  const isSimpleType =
    type === "core.todo" ||
    type === "core.meeting" ||
    type === "core.document_request" ||
    type === "core.review";

  if (isSimpleType) {
    switch (status) {
      case "draft":
        return { label: "Open", pill: "draft" };
      case "blocked":
        return { label: "Blocked", pill: "blocked" };
      case "review":
        return { label: "In review", pill: "review" };
      case "firm_approved":
        return { label: "Done", pill: "completed" };
      case "cancelled":
        return { label: "Cancelled", pill: "neutral" };
      default:
        return { label: status, pill: "neutral" };
    }
  }

  // Accounting / notary / etc. (Phase 2+) keep the canonical labels.
  switch (status) {
    case "draft":
      return { label: "Draft", pill: "draft" };
    case "blocked":
      return { label: "Blocked", pill: "blocked" };
    case "ingesting":
      return { label: "Ingesting", pill: "processing" };
    case "processing":
      return { label: "Processing", pill: "processing" };
    case "review":
      return { label: "In review", pill: "review" };
    case "firm_approved":
      return { label: "Approved", pill: "completed" };
    case "filed":
      return { label: "Filed", pill: "filed" };
    case "superseded":
      return { label: "Superseded", pill: "neutral" };
    case "cancelled":
      return { label: "Cancelled", pill: "neutral" };
    default:
      return { label: status, pill: "neutral" };
  }
}

/** Short human label for a task type. */
export function typeDisplay(type: string): string {
  switch (type) {
    case "core.todo":
      return "Todo";
    case "core.document_request":
      return "Doc request";
    case "core.review":
      return "Review";
    case "core.meeting":
      return "Meeting";
    default: {
      // Pretty-print last segment of the type id
      const last = type.split(".").pop() ?? type;
      return last.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    }
  }
}
