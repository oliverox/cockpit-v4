import type {
  ModuleManifest,
  TaskTypeDef,
  GuardrailDef,
  NavEntry,
} from "./types";
import { coreManifest } from "./core/manifest";

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
  // Industry modules will be added here in later phases:
  //   accountingManifest,
  //   notaryManifest,
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
 * `customerEnabledModules` further narrows the set per-customer (e.g.
 * a customer with the Payroll module disabled won't see its nav entries
 * even though the workspace has Payroll installed).
 */
export function getActiveModules(
  workspaceInstalledModules: string[],
  customerEnabledModules?: string[],
): ModuleManifest[] {
  const opted =
    customerEnabledModules !== undefined
      ? customerEnabledModules
      : workspaceInstalledModules;
  return MODULES.filter((m) => m.isBuiltIn || opted.includes(m.id));
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
