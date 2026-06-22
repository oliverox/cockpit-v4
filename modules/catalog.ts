/**
 * Server-safe module catalog.
 *
 * This is the SERIALIZABLE source of truth for module identity — plain data,
 * no React/icon imports — so it is safe to import from Convex functions.
 *
 * The *presentation* half of a module (nav icons, task renderers, guardrails)
 * lives in its `manifest.ts` and the client-only `registry.ts`. Never import
 * those from Convex: React components cannot cross the Convex boundary, and
 * pulling lucide-react into the server bundle is both wrong and wasteful.
 *
 * Keep this list in sync with the manifests registered in `registry.ts`.
 */
export type ModuleMeta = {
  id: string;
  name: string;
  description?: string;
  /** Built-in modules are always active and cannot be installed/uninstalled. */
  isBuiltIn?: boolean;
  industryTags?: string[];
};

export const MODULE_CATALOG: ModuleMeta[] = [
  {
    id: "core",
    name: "Core",
    description:
      "Built-in workspace primitives — generic tasks, documents, threads, calendar.",
    isBuiltIn: true,
  },
  {
    id: "accounting",
    name: "Accounting",
    description: "Chart of accounts, ledger, bank reconciliation, and VAT.",
    industryTags: ["accounting"],
  },
];

export function getCatalogModule(id: string): ModuleMeta | undefined {
  return MODULE_CATALOG.find((m) => m.id === id);
}

/** Modules a workspace can opt into (everything that isn't built-in). */
export function listInstallableModules(): ModuleMeta[] {
  return MODULE_CATALOG.filter((m) => !m.isBuiltIn);
}
