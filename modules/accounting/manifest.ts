import { BookOpen, Landmark } from "lucide-react";
import type { ModuleManifest } from "../types";
import { ACCOUNTING_TASK_TYPES } from "../server";
import { JournalEntryRenderer } from "./components/journal-entry-renderer";
import { BankRecRenderer } from "./components/bank-rec-renderer";

/**
 * The Accounting module.
 *
 * Industry module — installed per workspace via /settings/modules.
 *   Phase 1: Chart of Accounts ("Accounts" tab).
 *   Phase 2: the ledger ("Ledger" tab — income/expense, trial balance,
 *            transactions) + the journal-entry task type that posts to it.
 * Bank reconciliation, VAT and reports arrive in later phases.
 *
 * The server-safe halves live in modules/catalog.ts (identity), modules/server.ts
 * (task-type flags + guardrails) and convex/modules/accounting/* (substrate +
 * functions). This manifest is the client presentation layer — it carries React
 * (nav icons, task renderers) and spreads the server task-type defs in.
 */
export const accountingManifest: ModuleManifest = {
  id: "accounting",
  name: "Accounting",
  description: "Chart of accounts, ledger, bank reconciliation, and VAT.",
  industryTags: ["accounting"],

  navigation: {
    customer: [
      { label: "Accounts", href: "accounting/accounts", icon: Landmark },
      { label: "Ledger", href: "accounting/ledger", icon: BookOpen },
    ],
  },

  taskTypes: {
    "accounting.journal_entry": {
      ...ACCOUNTING_TASK_TYPES["accounting.journal_entry"],
      renderer: JournalEntryRenderer,
    },
    "accounting.bank_rec": {
      ...ACCOUNTING_TASK_TYPES["accounting.bank_rec"],
      renderer: BankRecRenderer,
      // Full-width import wizard — no chat embed alongside.
      fullWidth: true,
    },
  },
};
