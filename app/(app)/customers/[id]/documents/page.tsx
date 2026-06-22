"use client";

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  MoreHorizontal,
  Upload as UploadIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TagEditor } from "@/components/documents/tag-editor";
import { formatBytes, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/states";
import { PageShell } from "@/components/layout/page-shell";
import { CustomerHeader } from "@/components/customers/customer-header";

export default function CustomerDocumentsPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;

  const documents = useQuery(api.documents.listByCustomer, { customerId });
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createDocument = useMutation(api.documents.create);

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function uploadOne(file: File) {
    const uploadUrl = await generateUploadUrl();
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status}`);
    }
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    await createDocument({
      customerId,
      storageId,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
  }

  async function onFilesPicked(filesList: FileList | null) {
    if (!filesList || filesList.length === 0) return;
    const files = Array.from(filesList);
    setUploadError(null);
    setUploadingCount(files.length);
    try {
      for (const file of files) {
        await uploadOne(file);
        setUploadingCount((n) => n - 1);
      }
    } catch (err) {
      console.error(err);
      setUploadError(
        err instanceof Error ? err.message : "Upload failed",
      );
      setUploadingCount(0);
    }
  }

  return (
    <PageShell>
      <CustomerHeader
        customerId={customerId}
        actions={
          <Button onClick={() => inputRef.current?.click()}>
            <UploadIcon className="h-4 w-4" />
            Upload
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          void onFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="space-y-6">
        {uploadingCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-card-tint px-3 py-2 text-sm text-ink-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-fmu-navy" />
            Uploading {uploadingCount} file{uploadingCount === 1 ? "" : "s"}…
          </div>
        )}

        {uploadError && (
          <div
            role="alert"
            className="rounded-md border border-fmu-red/25 bg-fmu-red/[0.04] px-3 py-2.5 text-sm text-fmu-red"
          >
            {uploadError}
          </div>
        )}

        {documents === undefined && <LoadingState />}

        {documents !== undefined &&
          documents.length === 0 &&
          uploadingCount === 0 && (
            <p className="text-sm text-ink-3">No documents yet.</p>
          )}

        {documents !== undefined && documents.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-bg-2">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    Name
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    Size
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    Visibility
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    Uploaded
                  </th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <DocumentRow
                    key={doc._id}
                    doc={doc}
                    customerId={customerId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function DocumentRow({
  doc,
  customerId,
}: {
  doc: Doc<"documents">;
  customerId: Id<"customers">;
}) {
  const convex = useConvex();
  const setVisibility = useMutation(api.documents.setVisibility);
  const archive = useMutation(api.documents.archive);
  const unarchive = useMutation(api.documents.unarchive);

  async function download() {
    const url = await convex.query(api.documents.getDownloadUrl, {
      documentId: doc._id,
    });
    if (url) window.open(url, "_blank");
  }

  async function toggleVisibility() {
    await setVisibility({
      documentId: doc._id,
      visibility: doc.visibility === "shared" ? "firm" : "shared",
    });
  }

  return (
    <>
      <tr className={cn(doc.archived && "opacity-60")}>
        <td className="px-4 pt-3 pb-1 align-top">
          <button
            type="button"
            onClick={download}
            className="group inline-flex items-center gap-2 text-left text-sm font-medium text-ink hover:text-fmu-navy"
          >
            <FileIcon className="h-4 w-4 text-ink-3" />
            <span className="truncate underline-offset-4 group-hover:underline">
              {doc.fileName}
            </span>
          </button>
        </td>
        <td className="px-4 pt-3 pb-1 align-top">
          <span className="num text-sm text-ink-3">
            {formatBytes(doc.sizeBytes)}
          </span>
        </td>
        <td className="px-4 pt-3 pb-1 align-top">
          <VisibilityPill visibility={doc.visibility} />
        </td>
        <td className="px-4 pt-3 pb-1 align-top">
          <span className="num text-sm text-ink-3">
            {formatDate(doc._creationTime)}
          </span>
        </td>
        <td className="px-4 pt-3 pb-1 align-top text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Document actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => void download()}>
                <Download className="h-4 w-4" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggleVisibility()}>
                {doc.visibility === "shared" ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    Make firm-only
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    Share with client
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {doc.archived ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void unarchive({ documentId: doc._id })
                  }
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => void archive({ documentId: doc._id })}
                  className="text-fmu-red focus:text-fmu-red"
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      <tr
        className={cn(
          "border-b border-line last:border-b-0",
          doc.archived && "opacity-60",
        )}
      >
        <td colSpan={5} className="px-4 pt-0 pb-3">
          <TagEditor document={doc} customerId={customerId} />
        </td>
      </tr>
    </>
  );
}

function VisibilityPill({
  visibility,
}: {
  visibility: "firm" | "shared";
}) {
  if (visibility === "shared") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-fmu-green/10 px-2 py-0.5 text-[11px] font-medium text-fmu-green">
        <Eye className="h-3 w-3" />
        Shared
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-2 px-2 py-0.5 text-[11px] font-medium text-ink-3">
      <EyeOff className="h-3 w-3" />
      Firm only
    </span>
  );
}

