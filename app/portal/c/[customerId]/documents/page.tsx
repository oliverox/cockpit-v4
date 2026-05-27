"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { FileText, FolderOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatBytes, formatDate } from "@/lib/formatters";
import { EmptyState, LoadingState } from "@/components/states";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function PortalCustomerDocumentsPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId as Id<"customers">;
  const docs = useQuery(api.documents.listByCustomer, { customerId });

  return (
    <PageShell>
      <PageHeader eyebrow="Documents" title="Files shared with you" />

      {docs === undefined && <LoadingState />}
      {docs !== undefined && docs.length === 0 && (
        <EmptyState icon={FolderOpen}>No files shared yet.</EmptyState>
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
    </PageShell>
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
