"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { FileText, FolderOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

export default function PortalCustomerDocumentsPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId as Id<"customers">;
  const docs = useQuery(api.documents.listByCustomer, { customerId });

  return (
    <div className="w-full px-8 py-8">
      <header className="mb-6">
        <div className="eyebrow">Documents</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          Files shared with you
        </h1>
      </header>

      {docs === undefined && (
        <div className="text-sm text-ink-3">Loading…</div>
      )}
      {docs !== undefined && docs.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-6 py-8 text-center">
          <FolderOpen className="mx-auto mb-3 h-6 w-6 text-ink-4" />
          <p className="text-sm text-ink-3">No files shared yet.</p>
        </div>
      )}
      {docs !== undefined && docs.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
          {docs.map((d) => (
            <li key={d._id}>
              <DocumentRow doc={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: Doc<"documents"> }) {
  const downloadUrl = useQuery(api.documents.getDownloadUrl, {
    documentId: doc._id,
  });
  const target = downloadUrl ?? "#";

  return (
    <a
      href={target}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card-tint"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink group-hover:text-fmu-green">
          {doc.fileName}
        </div>
        <div className="num mt-0.5 text-[11px] text-ink-3">
          {formatDate(doc._creationTime)}
        </div>
      </div>
      <span className="num shrink-0 text-[11px] text-ink-4">
        {formatBytes(doc.sizeBytes)}
      </span>
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}
