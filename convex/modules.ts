import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getActor, canManageModules, isSuperadmin, type Actor } from "./lib/auth";
import { getCatalogModule, listInstallableModules } from "../modules/catalog";

/**
 * Module install/uninstall for a workspace.
 *
 * "Installing" a module just adds its id to `workspaces.installedModules`. The
 * registry (`modules/registry.ts`) gates every consumer — nav entries, task
 * types, guardrails — on that array, so toggling a module here surfaces or
 * hides its features everywhere. This layer is deliberately module-agnostic:
 * any future module (accounting, notary, …) installs through the same path.
 *
 * Only the SERIALIZABLE catalog (`modules/catalog.ts`) is imported here — never
 * the manifests, which carry React icon components that cannot cross the Convex
 * boundary.
 */

/** The workspace the actor is acting in, or undefined for clients/limbo. */
function actorWorkspaceId(actor: Actor): Id<"workspaces"> | undefined {
  if (actor.kind === "member") return actor.workspaceId;
  if (actor.kind === "superadmin") return actor.activeWorkspaceId;
  return undefined;
}

/**
 * The installable-module catalog joined with this workspace's install state.
 * Read-only and safe for any member/superadmin in a workspace; the toggle
 * mutations enforce `canManageModules`.
 */
export const listAvailable = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getActor(ctx);
    const workspaceId = actorWorkspaceId(actor);
    if (!workspaceId) return [];

    const workspace = await ctx.db.get(workspaceId);
    const installed = new Set(workspace?.installedModules ?? []);

    return listInstallableModules().map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      industryTags: m.industryTags,
      installed: installed.has(m.id),
    }));
  },
});

export const installModule = mutation({
  args: { moduleId: v.string() },
  handler: async (ctx, { moduleId }) => {
    const actor = await getActor(ctx);
    if (!canManageModules(actor)) throw new Error("Not authorised");
    const workspaceId = actorWorkspaceId(actor);
    if (!workspaceId) throw new Error("No active workspace");

    const mod = getCatalogModule(moduleId);
    if (!mod) throw new Error(`Unknown module: ${moduleId}`);
    if (mod.isBuiltIn) {
      throw new Error(`${mod.name} is built-in and always active.`);
    }

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const before = workspace.installedModules;
    if (before.includes(moduleId)) return; // idempotent

    const after = [...before, moduleId];
    await ctx.db.patch(workspaceId, { installedModules: after });

    const superadminContext = isSuperadmin(actor)
      ? { reason: actor.sessionReason }
      : undefined;
    await ctx.db.insert("audit_log", {
      workspaceId,
      actorId: actor.userId,
      subjectKind: "workspace",
      subjectTable: "workspaces",
      subjectId: workspaceId,
      action: "update",
      before: { installedModules: before },
      after: { installedModules: after },
      ...(superadminContext ? { superadminContext } : {}),
    });
  },
});

export const uninstallModule = mutation({
  args: { moduleId: v.string() },
  handler: async (ctx, { moduleId }) => {
    const actor = await getActor(ctx);
    if (!canManageModules(actor)) throw new Error("Not authorised");
    const workspaceId = actorWorkspaceId(actor);
    if (!workspaceId) throw new Error("No active workspace");

    const mod = getCatalogModule(moduleId);
    if (mod?.isBuiltIn) {
      throw new Error(`${mod.name} is built-in and cannot be uninstalled.`);
    }

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const before = workspace.installedModules;
    if (!before.includes(moduleId)) return; // idempotent

    // Note: uninstall hides the module's surfaces and stops processing; it does
    // NOT tear down substrate data (Convex has no per-module table teardown).
    const after = before.filter((id) => id !== moduleId);
    await ctx.db.patch(workspaceId, { installedModules: after });

    const superadminContext = isSuperadmin(actor)
      ? { reason: actor.sessionReason }
      : undefined;
    await ctx.db.insert("audit_log", {
      workspaceId,
      actorId: actor.userId,
      subjectKind: "workspace",
      subjectTable: "workspaces",
      subjectId: workspaceId,
      action: "update",
      before: { installedModules: before },
      after: { installedModules: after },
      ...(superadminContext ? { superadminContext } : {}),
    });
  },
});
