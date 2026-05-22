import type { ComponentType } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";

/**
 * Cockpit Module Manifest
 * -----------------------
 *
 * A module is a folder under `modules/<id>/` with a `manifest.ts` that
 * exports a `ModuleManifest`. The shell reads installed manifests and
 * wires up:
 *
 *   • Navigation entries (in the firm shell and the client portal)
 *   • Task type renderers (the generic task page dispatches by `task.type`)
 *   • Message card renderers (typed thread messages)
 *   • Artifact definitions (auto-generated PDFs/CSVs on task approval)
 *   • Prerequisites (declared task dependencies the core engine enforces)
 *   • Guardrails (per-status reopen policies and substrate field locks)
 *   • AI tools (Convex actions Control Tower can call)
 *
 * Phase 0 only declares the contract. Implementation hooks (renderers,
 * Convex function references, check functions) come online as we build
 * each surface.
 */

// ---- Navigation --------------------------------------------------------

export type NavEntry = {
  label: string;
  /** Relative slug appended to the customer or portal base route */
  href: string;
  icon?: ComponentType<{ className?: string }>;
};

// ---- Task types --------------------------------------------------------

export type TaskRendererProps = {
  taskId: Id<"tasks">;
  task: Doc<"tasks">;
};

export type TaskListItemProps = {
  task: Doc<"tasks">;
};

export type TaskTypeDef = {
  /** Short human label used on lists and pills. */
  label: string;
  /** Optional list-row renderer override. Defaults to a generic row. */
  listItem?: ComponentType<TaskListItemProps>;
  /**
   * Full-page renderer for the review/edit surface.
   * If omitted, the generic task page falls back to a JSON-payload view.
   */
  renderer?: ComponentType<TaskRendererProps>;
  /**
   * When true, the task page hands the entire canvas to the custom renderer
   * — no chat-embed side panel is rendered. Use for multi-step wizards or
   * other immersive UIs that own the full width.
   */
  fullWidth?: boolean;
  /** Optional default `clientVisible` for newly-created tasks of this type. */
  defaultClientVisible?: boolean;
};

// ---- Message cards -----------------------------------------------------

export type MessageCardProps<P = unknown> = {
  messageId: Id<"messages">;
  payload: P;
};

export type MessageCardDef = {
  renderer: ComponentType<MessageCardProps>;
};

// ---- Artifacts ---------------------------------------------------------

export type ArtifactDef = {
  id: string;
  title: string;
  mime: string;
  /**
   * Reference to the Convex action that renders the artifact, wired separately.
   * Stored as a string so the manifest can be imported in client code without
   * pulling in Convex internals.
   */
  renderActionRef?: string;
};

// ---- Prerequisites -----------------------------------------------------

export type PrerequisiteKind = "config" | "documents" | "task" | "substrate";

export type PrerequisiteFix =
  | {
      kind: "task";
      taskType: string;
      autoOffer?: boolean;
    }
  | {
      kind: "inline";
      /** Component that handles the fix (e.g. an upload dialog) */
      component: ComponentType<{ customerId: Id<"customers">; onResolved: () => void }>;
    };

export type PrerequisiteDef = {
  id: string;
  kind: PrerequisiteKind;
  label: string;
  /** Reference to the Convex query that checks the prereq. Wired separately. */
  checkRef?: string;
  fix?: PrerequisiteFix;
};

// ---- Guardrails --------------------------------------------------------

export type ReopenPolicy =
  | "free"
  | "blocked"
  | { requires: "admin" | "owner"; reason: "required" | "optional" };

export type GuardrailDef = {
  /** Declared statuses (for documentation; runtime uses the task status validator). */
  statuses: string[];
  /** Per-status policy on whether the task can be reopened. */
  reopenPolicy: Record<string, ReopenPolicy>;
  /**
   * Substrate field lock map.
   * Key = "<table>.<field>" (supports glob via `*`)
   * Value = lock scope, e.g. "period" or "any"
   */
  locks?: Record<string, "period" | "any">;
  /** Task type to spawn when a hard-locked task needs correction. */
  amendmentTask?: string;
};

// ---- AI tools ----------------------------------------------------------

export type AIToolDef = {
  name: string;
  description: string;
  /** Reference to the Convex action that runs when the AI calls this tool. */
  handlerRef: string;
  /** Required permission for the requester. */
  permission?: "tasks.read" | "tasks.create" | "tasks.approve" | "documents.read" | "documents.write";
};

// ---- The manifest ------------------------------------------------------

export type ModuleManifest = {
  id: string;
  name: string;
  description?: string;
  /** Set to true for the built-in `core` module. Hides it from the install catalog. */
  isBuiltIn?: boolean;
  /** Free-form tags used by the install catalog (e.g. "accounting", "legal"). */
  industryTags?: string[];

  navigation?: {
    /** Entries shown in the firm-member sidebar when inside a customer. */
    customer?: NavEntry[];
    /** Entries shown in the client portal sidebar. */
    portal?: NavEntry[];
  };

  taskTypes?: Record<string, TaskTypeDef>;
  messageCards?: Record<string, MessageCardDef>;

  /** Auto-generated artifacts keyed by task type. */
  artifacts?: Record<string, ArtifactDef[]>;

  /** Prerequisites keyed by task type. */
  prerequisites?: Record<string, PrerequisiteDef[]>;

  /** Guardrails keyed by task type. */
  guardrails?: Record<string, GuardrailDef>;

  aiTools?: AIToolDef[];

  /** Convex function refs for event subscriptions: { "document.uploaded": "modules.accounting.events.maybeScan" } */
  eventHandlerRefs?: Record<string, string>;
};
