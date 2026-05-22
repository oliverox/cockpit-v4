import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Cockpit v4 core schema.
 *
 * Layout:
 *   1. Tenancy & people    — workspaces, memberships, users, invites
 *   2. Customers & access  — customers, assignments, client access
 *   3. Documents & tasks   — documents, tasks, approvals
 *   4. Communication       — threads, members, messages
 *   5. Calendar & workflow — events, inbox, audit, event log
 *   6. Modules & integrations — settings, connectors, control tower
 *   7. Superadmins         — cross-workspace staff access
 *
 * Module-specific substrates (e.g. accounts, ledger_entries for accounting)
 * live in convex/modules/<id>/schema.ts and are stitched in at module install.
 */

// -- Common enums --------------------------------------------------------

const memberRole = v.union(
  v.literal("owner"),
  v.literal("member"),
);

const memberScope = v.union(
  v.literal("all"),
  v.literal("assigned_only"),
);

const userKind = v.union(v.literal("human"), v.literal("ai"));

const documentSource = v.union(
  v.literal("upload"),
  v.literal("chat"),
  v.literal("task"),
  v.literal("task_artifact"),
  v.literal("connector"),
);

const documentVisibility = v.union(v.literal("firm"), v.literal("shared"));

const taskStatus = v.union(
  v.literal("draft"),
  v.literal("blocked"),
  v.literal("ingesting"),
  v.literal("processing"),
  v.literal("review"),
  v.literal("firm_approved"),
  v.literal("filed"),
  v.literal("superseded"),
  v.literal("cancelled"),
);

const threadScope = v.union(v.literal("customer"), v.literal("team"));
const threadAudience = v.union(v.literal("firm"), v.literal("client"));
const threadKind = v.union(v.literal("dm"), v.literal("channel"));

const messageKind = v.union(
  v.literal("text"),
  v.literal("card"),
  v.literal("system"),
);

const inviteStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("expired"),
  v.literal("revoked"),
);

const connectorStatus = v.union(
  v.literal("connected"),
  v.literal("revoked"),
  v.literal("error"),
);

// -- Schema --------------------------------------------------------------

export default defineSchema({
  // ===================================================================
  // 1. Tenancy & people
  // ===================================================================

  /** A firm (tenant). Created entirely inside Cockpit; no external linkage. */
  workspaces: defineTable({
    name: v.string(),
    installedModules: v.array(v.string()),
    industryTags: v.optional(v.array(v.string())),
    archived: v.optional(v.boolean()),
  }),

  /** Firm members. A user can belong to multiple workspaces. */
  memberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: memberRole,
    scope: memberScope,
    /** Optional per-module permission scopes, e.g. ["accounting.read"] */
    permissionScopes: v.optional(v.array(v.string())),
    invitedBy: v.optional(v.id("users")),
    archived: v.optional(v.boolean()),
  })
    .index("by_workspace_and_user", ["workspaceId", "userId"])
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"]),

  /** Pending team-member invitations into a workspace. */
  team_invites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: memberRole,
    scope: memberScope,
    initialCustomerIds: v.optional(v.array(v.id("customers"))),
    invitedBy: v.id("users"),
    status: inviteStatus,
    expiresAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    acceptedMembershipId: v.optional(v.id("memberships")),
    clerkInvitationId: v.optional(v.string()),
    clerkInviteError: v.optional(v.string()),
  })
    .index("by_workspace_and_email", ["workspaceId", "email"])
    .index("by_status", ["status"])
    .index("by_email_and_status", ["email", "status"]),

  /**
   * Both human users (Clerk-backed) and AI agents.
   * AI agents have clerkId = undefined and agent populated.
   */
  users: defineTable({
    kind: userKind,
    /** Null for AI agents */
    clerkId: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),

    // AI-only
    agent: v.optional(
      v.object({
        description: v.string(),
        modelKey: v.string(),
        systemPromptKey: v.string(),
        capabilities: v.array(v.string()),
        contextScope: v.union(
          v.literal("thread"),
          v.literal("customer"),
          v.literal("workspace"),
        ),
        createdBy: v.id("users"),
        /** If null, this AI agent is workspace-bound via workspaceId */
        workspaceId: v.optional(v.id("workspaces")),
      }),
    ),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_kind", ["kind"]),

  // ===================================================================
  // 2. Customers & access
  // ===================================================================

  /** The end-clients a workspace serves. */
  customers: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    /** Override workspace.installedModules per customer */
    enabledModules: v.optional(v.array(v.string())),
    archived: v.optional(v.boolean()),
    /** Free-form metadata (BRN, NIC, etc.) — typed structures live in module substrates */
    metadata: v.optional(
      v.object({
        brn: v.optional(v.string()),
        vatRegistration: v.optional(v.string()),
        primaryContactEmail: v.optional(v.string()),
        primaryContactPhone: v.optional(v.string()),
        timezone: v.optional(v.string()),
      }),
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_archived", ["workspaceId", "archived"]),

  /** Which firm members are assigned to which customers. */
  customer_assignments: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    userId: v.id("users"),
    role: v.union(v.literal("lead"), v.literal("support")),
    assignedBy: v.id("users"),
  })
    .index("by_workspace_and_user", ["workspaceId", "userId"])
    .index("by_customer", ["customerId"])
    .index("by_user", ["userId"]),

  /** Client-portal access. Clients are linked to one or more customers. */
  customer_access: defineTable({
    customerId: v.id("customers"),
    userId: v.id("users"),
    role: v.union(v.literal("client_owner"), v.literal("client_viewer")),
    invitedBy: v.id("users"),
    invitedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_customer_and_user", ["customerId", "userId"])
    .index("by_user", ["userId"])
    .index("by_customer", ["customerId"]),

  /**
   * Pending portal invites — used when the firm invites an email that
   * doesn't yet match a Convex user. Resolved into `customer_access` rows
   * by `ensureUser` on first sign-in matching the email.
   *
   * `clerkInvitationId` is set when the Clerk Invitations API successfully
   * dispatches a magic-link email. Stays null when Clerk is misconfigured
   * (env var missing) or the API call fails — the manual share-the-URL
   * fallback still works in that case.
   */
  client_invites: defineTable({
    customerId: v.id("customers"),
    workspaceId: v.id("workspaces"),
    email: v.string(),
    role: v.union(v.literal("client_owner"), v.literal("client_viewer")),
    invitedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    expiresAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    acceptedAccessId: v.optional(v.id("customer_access")),
    clerkInvitationId: v.optional(v.string()),
    clerkInviteError: v.optional(v.string()),
  })
    .index("by_customer", ["customerId"])
    .index("by_email_and_status", ["email", "status"]),

  // ===================================================================
  // 3. Documents & tasks
  // ===================================================================

  documents: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    source: documentSource,
    visibility: documentVisibility,

    /** When the document is bound to a task (input or output) */
    taskId: v.optional(v.id("tasks")),
    /** When the document originated as a chat attachment */
    threadMessageId: v.optional(v.id("messages")),
    /** When the document is an auto-generated artifact (artifact registry id) */
    artifactKey: v.optional(v.string()),

    /** Human-applied + classifier-applied tags */
    tags: v.array(v.string()),
    /** Module-specific classification payload */
    classifications: v.optional(
      v.record(v.string(), v.any()),
    ),
    /** Who uploaded it (firm member or client) */
    uploadedBy: v.id("users"),

    archived: v.optional(v.boolean()),
  })
    .index("by_workspace_and_customer", ["workspaceId", "customerId"])
    .index("by_customer_and_source", ["customerId", "source"])
    .index("by_task", ["taskId"])
    .index("by_thread_message", ["threadMessageId"])
    .index("by_customer_and_visibility", ["customerId", "visibility"]),

  /**
   * Tasks are the generic envelope every module's work fits into.
   * The renderer for `type` lives in that module's manifest.
   */
  tasks: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    moduleId: v.string(),
    type: v.string(),
    status: taskStatus,
    /** Human-readable title shown in lists & inbox */
    title: v.string(),

    assignedTo: v.optional(v.id("users")),
    createdBy: v.id("users"),
    dueDate: v.optional(v.number()),
    clientVisible: v.boolean(),

    /** Module-specific draft state. Frozen on approval (mirrored to substrate). */
    payload: v.any(),

    /** Tasks this one waits on (small, bounded — typically 0–3 entries) */
    blockedBy: v.array(v.id("tasks")),

    /** Snapshot of prereq checks. Recomputed live on substrate writes. */
    prerequisitesSnapshot: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          met: v.boolean(),
          fixTaskId: v.optional(v.id("tasks")),
        }),
      ),
    ),

    /** Amendment relationships */
    amendsTaskId: v.optional(v.id("tasks")),
    amendedByTaskId: v.optional(v.id("tasks")),
  })
    .index("by_workspace_and_customer", ["workspaceId", "customerId"])
    .index("by_customer_and_status", ["customerId", "status"])
    .index("by_customer_and_type", ["customerId", "type"])
    .index("by_assigned_to_and_status", ["assignedTo", "status"])
    .index("by_due_date", ["dueDate"]),

  /**
   * Approval snapshots — what side effects fired when a task was approved.
   * Used to reverse changes on reopen.
   */
  task_approvals: defineTable({
    taskId: v.id("tasks"),
    workspaceId: v.id("workspaces"),
    approvedBy: v.id("users"),
    approvedAt: v.number(),
    /** Which status the task transitioned INTO */
    toStatus: taskStatus,
    /** Reversible side-effect log */
    sideEffects: v.array(
      v.object({
        kind: v.union(
          v.literal("substrate"),
          v.literal("document"),
          v.literal("card"),
          v.literal("event"),
        ),
        table: v.optional(v.string()),
        refId: v.string(),
        op: v.union(v.literal("create"), v.literal("update")),
        before: v.optional(v.any()),
        after: v.optional(v.any()),
      }),
    ),
    reversedAt: v.optional(v.number()),
    reversedBy: v.optional(v.id("users")),
  })
    .index("by_task", ["taskId"])
    .index("by_workspace_and_approved_at", ["workspaceId", "approvedAt"]),

  // ===================================================================
  // 4. Communication
  // ===================================================================

  threads: defineTable({
    workspaceId: v.id("workspaces"),
    scope: threadScope,

    // when scope = "customer"
    customerId: v.optional(v.id("customers")),
    audience: v.optional(threadAudience),

    // when scope = "team"
    kind: v.optional(threadKind),
    channelName: v.optional(v.string()),
    channelDescription: v.optional(v.string()),
    isPrivate: v.optional(v.boolean()),

    createdBy: v.id("users"),
    lastMessageAt: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_scope", ["workspaceId", "scope"])
    .index("by_customer_and_audience", ["customerId", "audience"])
    .index("by_channel_name", ["workspaceId", "channelName"]),

  thread_members: defineTable({
    threadId: v.id("threads"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("member"),
      v.literal("viewer"),
    ),
    joinedAt: v.number(),
    lastReadAt: v.optional(v.number()),
    notifications: v.union(
      v.literal("all"),
      v.literal("mentions"),
      v.literal("none"),
    ),
  })
    .index("by_thread", ["threadId"])
    .index("by_user", ["userId"])
    .index("by_thread_and_user", ["threadId", "userId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    workspaceId: v.id("workspaces"),
    authorId: v.id("users"),
    kind: messageKind,

    text: v.optional(v.string()),

    // card kind
    cardType: v.optional(v.string()),
    cardPayload: v.optional(v.any()),

    /** Attached document ids (small, bounded — usually ≤ 10) */
    attachments: v.optional(v.array(v.id("documents"))),
    /** @-mentions (small, bounded) */
    mentions: v.optional(v.array(v.id("users"))),
    /** #task references — clickable chips, filterable. Bounded (≤ ~10). */
    taskRefs: v.optional(v.array(v.id("tasks"))),

    replyToId: v.optional(v.id("messages")),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),

    /** AI streaming — true while the LLM is still writing */
    streaming: v.optional(v.boolean()),
  })
    .index("by_thread", ["threadId"])
    .index("by_workspace_and_author", ["workspaceId", "authorId"]),

  // ===================================================================
  // 5. Calendar & workflow
  // ===================================================================

  calendar_events: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    start: v.number(),
    end: v.optional(v.number()),
    allDay: v.boolean(),

    customerId: v.optional(v.id("customers")),
    taskId: v.optional(v.id("tasks")),
    assignedTo: v.array(v.id("users")),
    category: v.union(
      v.literal("deadline"),
      v.literal("meeting"),
      v.literal("reminder"),
      v.literal("milestone"),
      v.literal("custom"),
    ),

    /** Source of the event */
    source: v.union(
      v.literal("manual"),
      v.literal("task"),
      v.literal("module"),
    ),
    moduleId: v.optional(v.string()),
    /** Stable key per (moduleId, customerId) for idempotent regeneration */
    naturalKey: v.optional(v.string()),

    recurrence: v.optional(v.object({ rrule: v.string() })),

    /** Reserved for future Google/Outlook sync */
    externalRef: v.optional(
      v.object({
        provider: v.union(v.literal("google"), v.literal("outlook")),
        id: v.string(),
      }),
    ),

    createdBy: v.id("users"),
  })
    .index("by_workspace_and_start", ["workspaceId", "start"])
    .index("by_customer_and_start", ["customerId", "start"])
    .index("by_task", ["taskId"])
    .index("by_module_natural_key", ["moduleId", "naturalKey"]),

  /** Append-only event bus that modules subscribe to. */
  events: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.optional(v.id("customers")),
    type: v.string(),
    payload: v.any(),
    sourceModuleId: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
  })
    .index("by_workspace_and_type", ["workspaceId", "type"])
    .index("by_customer_and_type", ["customerId", "type"]),

  /** Cross-module "things waiting on me" aggregator. */
  inbox_items: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("task_review"),
      v.literal("mention"),
      v.literal("signature_request"),
      v.literal("document_request"),
      v.literal("connector_error"),
      v.literal("custom"),
    ),
    /** Polymorphic reference — table:id pair */
    ref: v.object({
      table: v.string(),
      id: v.string(),
    }),
    title: v.string(),
    subtitle: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    readAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_user_and_read", ["userId", "readAt"])
    .index("by_user", ["userId"])
    .index("by_workspace_and_user", ["workspaceId", "userId"]),

  /** Audit trail of substrate writes, approvals, and reopens. */
  audit_log: defineTable({
    workspaceId: v.id("workspaces"),
    actorId: v.id("users"),
    /** When AI is acting on behalf of a human */
    onBehalfOf: v.optional(v.id("users")),
    /** When a superadmin is acting cross-workspace. Captures their reason. */
    superadminContext: v.optional(
      v.object({
        reason: v.optional(v.string()),
      }),
    ),
    /** What was changed — flattened for indexing */
    subjectKind: v.union(
      v.literal("task"),
      v.literal("substrate"),
      v.literal("document"),
      v.literal("workspace"),
      v.literal("customer"),
      v.literal("membership"),
    ),
    subjectTable: v.optional(v.string()),
    subjectId: v.string(),
    action: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("approve"),
      v.literal("reopen"),
      v.literal("file"),
      v.literal("override"),
    ),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    reason: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_subject", ["subjectTable", "subjectId"]),

  // ===================================================================
  // 6. Modules & integrations
  // ===================================================================

  /** Per-workspace, per-module settings (e.g. accounting's VAT filing schedule). */
  module_settings: defineTable({
    workspaceId: v.id("workspaces"),
    moduleId: v.string(),
    customerId: v.optional(v.id("customers")), // null = workspace-level
    settings: v.any(),
    updatedBy: v.id("users"),
  })
    .index("by_workspace_and_module", ["workspaceId", "moduleId"])
    .index("by_customer_and_module", ["customerId", "moduleId"]),

  /** External integrations per customer. Encrypted credential ciphertext only. */
  connectors: defineTable({
    workspaceId: v.id("workspaces"),
    customerId: v.id("customers"),
    provider: v.string(), // e.g. "t1_expenses", "mcb_bank"
    status: connectorStatus,
    /** Encrypted credentials — never returned to clients */
    ciphertext: v.string(),
    metadata: v.optional(v.any()),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    connectedBy: v.id("users"),
  })
    .index("by_workspace_and_customer", ["workspaceId", "customerId"])
    .index("by_customer_and_provider", ["customerId", "provider"]),

  /** Tracks already-imported external item ids for idempotent re-syncs. */
  connector_imports: defineTable({
    connectorId: v.id("connectors"),
    externalId: v.string(),
    /** Local row created from the import (e.g. a documents._id or tasks._id) */
    localRef: v.optional(
      v.object({
        table: v.string(),
        id: v.string(),
      }),
    ),
  })
    .index("by_connector_and_external", ["connectorId", "externalId"]),

  /** State for the Control Tower right-rail surface (context chips, etc.). */
  control_tower_sessions: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    threadId: v.id("threads"),
    context: v.object({
      customerId: v.optional(v.id("customers")),
      period: v.optional(v.string()), // e.g. "2026-03" or "2026-Q1"
      taskId: v.optional(v.id("tasks")),
      documentIds: v.optional(v.array(v.id("documents"))),
    }),
  })
    .index("by_user", ["userId"])
    .index("by_thread", ["threadId"]),

  // ===================================================================
  // 7. Superadmins (Cockpit staff cross-workspace access)
  // ===================================================================

  /**
   * App-level staff accounts. Independent of Clerk Organizations — a row
   * here grants the user cross-workspace read/write capability with their
   * own identity preserved in the audit log.
   *
   * Bootstrap by manual insert in the Convex dashboard.
   */
  superadmins: defineTable({
    userId: v.id("users"),
    grantedBy: v.optional(v.id("users")),
    reason: v.optional(v.string()), // "founder", "engineering on-call", etc.
    archived: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"]),

  /**
   * Tracks which workspace a superadmin is currently impersonating. Cleared
   * on sign-out (or explicit "exit superadmin mode"). One row per superadmin
   * at any given time — older rows can be deleted or marked inactive.
   */
  superadmin_sessions: defineTable({
    userId: v.id("users"),
    activeWorkspaceId: v.id("workspaces"),
    reason: v.optional(v.string()), // e.g. "support ticket #4321"
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    // Convex auto-appends _creationTime, so `by_user` ordered desc + take(1)
    // returns the most recent session for this user.
    .index("by_user", ["userId"])
    .index("by_workspace", ["activeWorkspaceId"]),
});
