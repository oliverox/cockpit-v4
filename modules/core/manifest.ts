import type { ModuleManifest } from "../types";
import { CORE_GUARDRAILS, CORE_TASK_TYPES } from "../server";

/**
 * The Core module.
 *
 * Built-in, can't be uninstalled. Provides the generic task types every
 * workspace gets out of the box, regardless of which industry modules are
 * installed. An agency or consulting firm running Cockpit with zero industry
 * modules still has everything in here.
 *
 * The task-type *flags* and guardrails live in the React-free `../server`
 * registry (the single source of truth Convex reads from); this manifest adds
 * the client-only presentation (renderers/nav) on top. Core has no custom
 * renderers yet, so it spreads the server defs as-is.
 */
export const coreManifest: ModuleManifest = {
  id: "core",
  name: "Core",
  description:
    "Built-in workspace primitives — generic tasks, documents, threads, calendar.",
  isBuiltIn: true,

  taskTypes: CORE_TASK_TYPES,
  guardrails: CORE_GUARDRAILS,
};
