import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  canActInWorkspace,
  canManageTeam,
  canSeeCustomer,
  getActor,
  isSuperadmin,
  tryGetActor,
} from "./lib/auth";

/**
 * Documents — uploaded files attached to a customer.
 *
 * Upload flow:
 *   1. Client calls `generateUploadUrl` (mutation) → signed Convex Storage URL.
 *   2. Client POSTs the file to that URL, receives a `storageId`.
 *   3. Client calls `create` with the `storageId` + metadata.
 *
 * Download flow:
 *   1. Client calls `getDownloadUrl(documentId)` (query) → signed URL.
 *   2. Client GETs the URL, or links to it.
 *
 * Per the architecture, this is core (every workspace gets it).
 */

const visibilityValidator = v.union(
  v.literal("firm"),
  v.literal("shared"),
);

// 50 MB cap per file for Phase 1.2. Adjust later.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// ---- Storage URLs --------------------------------------------------------

/** Step 1 of the upload flow. Returns a one-shot signed upload URL. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Just ensure the caller is authenticated and has an active workspace.
    // Files that get uploaded but never recorded are orphaned in storage —
    // a periodic cleanup task can sweep them later.
    const actor = await getActor(ctx);
    if (!canActInWorkspace(actor, getActorWorkspaceOrThrow(actor))) {
      throw new Error("No active workspace");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2: record the upload as a document row. */
export const create = mutation({
  args: {
    customerId: v.id("customers"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    tags: v.optional(v.array(v.string())),
    visibility: v.optional(visibilityValidator),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);

    if (args.sizeBytes > MAX_FILE_BYTES) {
      throw new Error(
        `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`,
      );
    }

    const customer = await ctx.db.get(args.customerId);
    if (!customer) throw new Error("Customer not found");

    const allowed = await canSeeCustomer(ctx, actor, args.customerId);
    if (!allowed) throw new Error("No access to this customer");

    if (!canActInWorkspace(actor, customer.workspaceId)) {
      throw new Error("Cannot upload to this workspace");
    }

    const fileName = args.fileName.trim().slice(0, 255) || "untitled";

    const documentId = await ctx.db.insert("documents", {
      workspaceId: customer.workspaceId,
      customerId: args.customerId,
      storageId: args.storageId,
      fileName,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      source: "upload",
      visibility: args.visibility ?? "firm",
      tags: args.tags ?? [],
      uploadedBy: actor.userId,
    });

    await ctx.db.insert("audit_log", {
      workspaceId: customer.workspaceId,
      actorId: actor.userId,
      subjectKind: "document",
      subjectTable: "documents",
      subjectId: documentId,
      action: "create",
      after: {
        fileName,
        contentType: args.contentType,
        sizeBytes: args.sizeBytes,
        customerId: args.customerId,
      },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return documentId;
  },
});

/** Signed download URL. Auth-checked so unauthorised callers get null. */
export const getDownloadUrl = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return null;

    const document = await ctx.db.get(args.documentId);
    if (!document) return null;

    const allowed = await canSeeCustomer(ctx, actor, document.customerId);
    if (!allowed) return null;

    return await ctx.storage.getUrl(document.storageId);
  },
});

// ---- Listing ------------------------------------------------------------

export const listByCustomer = query({
  args: {
    customerId: v.id("customers"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];

    const customer = await ctx.db.get(args.customerId);
    if (!customer) return [];

    const allowed = await canSeeCustomer(ctx, actor, args.customerId);
    if (!allowed) return [];

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_workspace_and_customer", (q) =>
        q
          .eq("workspaceId", customer.workspaceId)
          .eq("customerId", args.customerId),
      )
      .order("desc")
      .take(500);

    const includeArchived = args.includeArchived === true;
    const visible = includeArchived ? docs : docs.filter((d) => !d.archived);

    // For client actors, only return shared documents.
    if (actor.kind === "client") {
      return visible.filter((d) => d.visibility === "shared");
    }

    return visible;
  },
});

// ---- Mutations on existing documents -----------------------------------

export const setVisibility = mutation({
  args: {
    documentId: v.id("documents"),
    visibility: visibilityValidator,
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");
    if (!canActInWorkspace(actor, document.workspaceId)) {
      throw new Error("No access to this document");
    }
    if (document.visibility === args.visibility) return args.documentId;

    const before = { visibility: document.visibility };
    await ctx.db.patch(args.documentId, { visibility: args.visibility });

    await ctx.db.insert("audit_log", {
      workspaceId: document.workspaceId,
      actorId: actor.userId,
      subjectKind: "document",
      subjectTable: "documents",
      subjectId: args.documentId,
      action: "update",
      before,
      after: { visibility: args.visibility },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.documentId;
  },
});

/**
 * Replace the tag list on a document. Tags are lowercased, trimmed,
 * deduped, capped at 40 chars each and 20 tags per document.
 */
export const setTags = mutation({
  args: {
    documentId: v.id("documents"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");
    if (!canActInWorkspace(actor, document.workspaceId)) {
      throw new Error("No access to this document");
    }

    const normalized = Array.from(
      new Set(
        args.tags
          .map((t) => t.trim().toLowerCase().slice(0, 40))
          .filter(Boolean),
      ),
    ).slice(0, 20);

    if (
      normalized.length === document.tags.length &&
      normalized.every((t, i) => t === document.tags[i])
    ) {
      return args.documentId;
    }

    const before = { tags: document.tags };
    await ctx.db.patch(args.documentId, { tags: normalized });

    await ctx.db.insert("audit_log", {
      workspaceId: document.workspaceId,
      actorId: actor.userId,
      subjectKind: "document",
      subjectTable: "documents",
      subjectId: args.documentId,
      action: "update",
      before,
      after: { tags: normalized },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.documentId;
  },
});

/**
 * Distinct tags across all non-archived documents of a customer.
 * Used for tag autocomplete. Returns a sorted unique list.
 */
export const listTagsByCustomer = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const actor = await tryGetActor(ctx);
    if (!actor) return [];

    const customer = await ctx.db.get(args.customerId);
    if (!customer) return [];

    const allowed = await canSeeCustomer(ctx, actor, args.customerId);
    if (!allowed) return [];

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_workspace_and_customer", (q) =>
        q
          .eq("workspaceId", customer.workspaceId)
          .eq("customerId", args.customerId),
      )
      .take(500);

    const seen = new Set<string>();
    for (const doc of docs) {
      if (doc.archived) continue;
      for (const t of doc.tags) seen.add(t);
    }
    return Array.from(seen).sort();
  },
});

export const rename = mutation({
  args: {
    documentId: v.id("documents"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");
    if (!canActInWorkspace(actor, document.workspaceId)) {
      throw new Error("No access to this document");
    }

    const next = args.fileName.trim().slice(0, 255);
    if (!next) throw new Error("File name cannot be empty");
    if (next === document.fileName) return args.documentId;

    await ctx.db.patch(args.documentId, { fileName: next });

    await ctx.db.insert("audit_log", {
      workspaceId: document.workspaceId,
      actorId: actor.userId,
      subjectKind: "document",
      subjectTable: "documents",
      subjectId: args.documentId,
      action: "update",
      before: { fileName: document.fileName },
      after: { fileName: next },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.documentId;
  },
});

export const archive = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");
    if (!canActInWorkspace(actor, document.workspaceId)) {
      throw new Error("No access");
    }
    if (!canManageTeam(actor)) {
      throw new Error("Only admins can archive documents");
    }
    if (document.archived) return args.documentId;

    await ctx.db.patch(args.documentId, { archived: true });

    await ctx.db.insert("audit_log", {
      workspaceId: document.workspaceId,
      actorId: actor.userId,
      subjectKind: "document",
      subjectTable: "documents",
      subjectId: args.documentId,
      action: "update",
      before: { archived: false },
      after: { archived: true },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.documentId;
  },
});

export const unarchive = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const actor = await getActor(ctx);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");
    if (!canActInWorkspace(actor, document.workspaceId)) {
      throw new Error("No access");
    }
    if (!canManageTeam(actor)) {
      throw new Error("Only admins can unarchive documents");
    }
    if (!document.archived) return args.documentId;

    await ctx.db.patch(args.documentId, { archived: false });

    await ctx.db.insert("audit_log", {
      workspaceId: document.workspaceId,
      actorId: actor.userId,
      subjectKind: "document",
      subjectTable: "documents",
      subjectId: args.documentId,
      action: "update",
      before: { archived: true },
      after: { archived: false },
      superadminContext: isSuperadmin(actor)
        ? { reason: actor.sessionReason }
        : undefined,
    });

    return args.documentId;
  },
});

// ---- Helpers ------------------------------------------------------------

function getActorWorkspaceOrThrow(
  actor: Awaited<ReturnType<typeof getActor>>,
): import("./_generated/dataModel").Id<"workspaces"> {
  if (actor.kind === "member") return actor.workspaceId;
  if (actor.kind === "superadmin" && actor.activeWorkspaceId)
    return actor.activeWorkspaceId;
  throw new Error("No active workspace");
}
