"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileText, Upload, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  taskId: Id<"tasks">;
  customerId: Id<"customers">;
  disabled?: boolean;
  /** Customise the heading copy — useful for document_request tasks. */
  label?: string;
  /** Customise the empty-state copy. */
  emptyHint?: string;
};

/**
 * File-attach + listing surface for a single task.
 *
 * On upload: get a signed URL → POST file → record document with `taskId`.
 * The mutation auto-tags `source: "task"` and (for client-visible tasks)
 * `visibility: "shared"`. It also posts a `document.uploaded` system card
 * into the firm thread and advances a `core.document_request` task from
 * draft → review on the first attachment.
 */
export function TaskAttachments({
  taskId,
  customerId,
  disabled,
  label = "Attached files",
  emptyHint = "No files yet.",
}: Props) {
  const docs = useQuery(api.documents.listByTask, { taskId });
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createDocument = useMutation(api.documents.create);

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      for (const file of arr) {
        const url = await generateUploadUrl({});
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }
        const json = (await res.json()) as { storageId: Id<"_storage"> };
        await createDocument({
          customerId,
          storageId: json.storageId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          taskId,
        });
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {docs && docs.length > 0 && (
          <span className="text-[11px] text-ink-4">
            {docs.length} file{docs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {docs === undefined ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : (
        <div>
          {docs.length > 0 && (
            <ul className="mb-2 flex flex-col">
              {docs.map((d) => (
                <li
                  key={d._id}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-card-tint"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  <FileLink document={d} />
                  <span className="num shrink-0 text-[11px] text-ink-4">
                    {formatBytes(d.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div
            onDragOver={(e) => {
              if (disabled || uploading) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (disabled || uploading) return;
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2.5 transition-colors",
              dragOver
                ? "border-fmu-navy bg-fmu-navy/5"
                : "border-line-2 bg-transparent",
              (disabled || uploading) && "opacity-60",
            )}
          >
            <div className="text-[12px] text-ink-3">
              {uploading
                ? "Uploading…"
                : docs.length > 0
                  ? "Drop more files, or"
                  : emptyHint.replace(/, or use Add files\.?$/, ", or")}
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              disabled={disabled || uploading}
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Add files"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-[12px] text-fmu-red">
          <X className="h-3 w-3" />
          {error}
        </div>
      )}
    </section>
  );
}

function FileLink({ document }: { document: Doc<"documents"> }) {
  const url = useQuery(api.documents.getDownloadUrl, {
    documentId: document._id,
  });
  if (!url) {
    return (
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        {document.fileName}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-fmu-navy hover:underline"
    >
      {document.fileName}
    </a>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
