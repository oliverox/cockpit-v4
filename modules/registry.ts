import type {
  ModuleManifest,
  TaskTypeDef,
  GuardrailDef,
  NavEntry,
} from "./types";
import { coreManifest } from "./core/manifest";
import { notaryManifest } from "./notary/manifest";

/**
 * Static registry of all known modules.
 *
 * Built-in modules (`isBuiltIn: true`) are always present. Industry modules
 * are present in the array but only active for workspaces that opted in via
 * `workspace.installedModules`. The registry just holds the manifests —
 * gating happens at the consumer site (see `getActiveModules`).
 */
const MODULES: ModuleManifest[] = [
  coreManifest,
  // ⚠️ Phase-0 throwaway: proves the install → nav toggle path end-to-end with
  // zero accounting code. Remove when the real Accounting module lands (Phase 1).
  notaryManifest,
  // Industry modules will be added here in later phases:
  //   accountingManifest,
];

/** Every module the codebase knows about. */
export function getAllModules(): ModuleManifest[] {
  return MODULES;
}

/** Look up a single module by id. */
export function getModule(id: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.id === id);
}

/**
 * Resolve the active modules for a workspace.
 *
 *   • Built-in modules are always active.
 *   • Industry modules are active iff the workspace has opted in.
 *
 * `customerEnabledModules` further NARROWS the set per-customer (e.g.
 * a customer with the Payroll module disabled won't see its nav entries
 * even though the workspace has Payroll installed). It can only subtract from
 * the workspace's installed set, never add — a module must be installed at the
 * workspace before any customer can use it.
 */
export function getActiveModules(
  workspaceInstalledModules: string[],
  customerEnabledModules?: string[],
): ModuleManifest[] {
  return MODULES.filter((m) => {
    if (m.isBuiltIn) return true;
    // Must be installed at the workspace.
    if (!workspaceInstalledModules.includes(m.id)) return false;
    // If the customer declares an explicit enabled set, narrow to it.
    if (customerEnabledModules !== undefined) {
      return customerEnabledModules.includes(m.id);
    }
    return true;
  });
}

// ---- Cross-module lookups ----------------------------------------------

/** Find the task-type definition for `task.type`, searching across all modules. */
export function getTaskTypeDef(type: string): TaskTypeDef | undefined {
  for (const m of MODULES) {
    const def = m.taskTypes?.[type];
    if (def) return def;
  }
  return undefined;
}

/** Find the module that owns a given task type. */
export function getModuleForTaskType(type: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.taskTypes && type in m.taskTypes);
}

/** Find the guardrail for a given task type, searching across all modules. */
export function getGuardrailForTaskType(
  type: string,
): GuardrailDef | undefined {
  for (const m of MODULES) {
    const g = m.guardrails?.[type];
    if (g) return g;
  }
  return undefined;
}

/** All customer-rail nav entries contributed by active modules. */
export function getCustomerNavEntries(
  activeModules: ModuleManifest[],
): Array<NavEntry & { moduleId: string }> {
  return activeModules.flatMap((m) =>
    (m.navigation?.customer ?? []).map((entry) => ({
      ...entry,
      moduleId: m.id,
    })),
  );
}

/** All portal nav entries contributed by active modules. */
export function getPortalNavEntries(
  activeModules: ModuleManifest[],
): Array<NavEntry & { moduleId: string }> {
  return activeModules.flatMap((m) =>
    (m.navigation?.portal ?? []).map((entry) => ({
      ...entry,
      moduleId: m.id,
    })),
  );
}
