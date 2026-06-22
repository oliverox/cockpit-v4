import { Landmark } from "lucide-react";
import type { ModuleManifest } from "../types";

/**
 * The Accounting module.
 *
 * Industry module — installed per workspace via /settings/modules. Phase 1
 * ships the Chart of Accounts: an "Accounts" tab on each customer that opens
 * the COA management screen. Ledger, bank reconciliation, VAT and reports
 * (with their task types, guardrails and artifacts) arrive in later phases.
 *
 * The server-safe halves of this module live in modules/catalog.ts (identity)
 * and convex/modules/accounting/* (substrate + functions). This manifest is
 * the client presentation layer — safe to carry React (nav icons, renderers).
 */
export const accountingManifest: ModuleManifest = {
  id: "accounting",
  name: "Accounting",
  description: "Chart of accounts, ledger, bank reconciliation, and VAT.",
  industryTags: ["accounting"],

  navigation: {
    customer: [
      { label: "Accounts", href: "accounting/accounts", icon: Landmark },
    ],
  },
};
