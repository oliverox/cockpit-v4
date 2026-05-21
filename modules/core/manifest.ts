import type { ModuleManifest } from "../types";

/**
 * The Core module.
 *
 * Built-in, can't be uninstalled. Provides the generic task types every
 * workspace gets out of the box, regardless of which industry modules are
 * installed. An agency or consulting firm running Cockpit with zero industry
 * modules still has everything in here.
 */
export const coreManifest: ModuleManifest = {
  id: "core",
  name: "Core",
  description:
    "Built-in workspace primitives — generic tasks, documents, threads, calendar.",
  isBuiltIn: true,

  taskTypes: {
    "core.todo": {
      label: "Todo",
      defaultClientVisible: false,
    },
    "core.document_request": {
      label: "Document request",
      defaultClientVisible: true,
    },
    "core.review": {
      label: "Review",
      defaultClientVisible: true,
    },
    "core.meeting": {
      label: "Meeting",
      defaultClientVisible: false,
    },
  },

  guardrails: {
    "core.todo": {
      statuses: ["draft", "review", "firm_approved", "cancelled"],
      reopenPolicy: {
        draft: "free",
        review: "free",
        firm_approved: "free",
      },
    },
    "core.document_request": {
      statuses: ["draft", "review", "firm_approved", "cancelled"],
      reopenPolicy: {
        draft: "free",
        review: "free",
        firm_approved: "free",
      },
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
      reopenPolicy: {
        draft: "free",
        firm_approved: "free",
      },
    },
  },
};
