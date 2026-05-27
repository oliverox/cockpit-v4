"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { CalendarDays, FileText, ListChecks, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatBytes, formatDate } from "@/lib/formatters";
import { typeDisplay } from "@/lib/task-display";

export type CardSurface = "firm" | "portal";

type Props = {
  cardType: string;
  cardPayload: unknown;
  customerId: Id<"customers">;
  surface?: CardSurface;
  /** When set, clicking a task.created card calls this instead of navigating. */
  onSelectTask?: (taskId: Id<"tasks">) => void;
  /** When set, clicking a document.uploaded card calls this instead of navigating. */
  onSelectDocument?: (
    documentId: Id<"documents">,
    taskId: Id<"tasks">,
  ) => void;
};

function taskHref(
  surface: CardSurface,
  customerId: Id<"customers">,
  taskId: Id<"tasks">,
) {
  return surface === "portal"
    ? `/portal/c/${customerId}/tasks/${taskId}`
    : `/customers/${customerId}/tasks/${taskId}`;
}

/**
 * System cards posted into threads by the platform (not by humans).
 * Currently handles `task.created`. New card types add a branch here and
 * a renderer; the database shape (kind: "card" + cardType + cardPayload)
 * stays the same.
 */
export function MessageCard({
  cardType,
  cardPayload,
  customerId,
  surface = "firm",
  onSelectTask,
  onSelectDocument,
}: Props) {
  if (cardType === "task.created") {
    const p = cardPayload as {
      taskId: Id<"tasks">;
      title: string;
      type: string;
      dueDate?: number;
    };
    const isRequest = p.type === "core.document_request";
    const cardBody = (
      <>
        <div className="flex items-center gap-2">
          {isRequest ? (
            <Upload className="h-3.5 w-3.5 shrink-0 text-fmu-navy" />
          ) : (
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-fmu-navy" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fmu-navy">
            {isRequest ? "Documents requested" : "New task"}
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-ink-4">
            · {typeDisplay(p.type)}
          </span>
        </div>
        <div className="mt-1.5 text-sm font-medium text-ink group-hover:text-fmu-navy">
          {p.title}
        </div>
        {p.dueDate && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
            <CalendarDays className="h-3 w-3" />
            <span className="num">Due {formatDate(p.dueDate)}</span>
          </div>
        )}
      </>
    );
    const sharedClass =
      "group block w-full text-left rounded-lg border border-line bg-card-tint/60 px-3 py-2.5 transition-colors hover:border-fmu-navy/30 hover:bg-card-tint";
    return onSelectTask ? (
      <button
        type="button"
        onClick={() => onSelectTask(p.taskId)}
        className={sharedClass}
      >
        {cardBody}
      </button>
    ) : (
      <Link
        href={taskHref(surface, customerId, p.taskId)}
        prefetch={false}
        className={sharedClass}
      >
        {cardBody}
      </Link>
    );
  }

  if (cardType === "document.uploaded") {
    const p = cardPayload as {
      taskId: Id<"tasks">;
      documentId: Id<"documents">;
      fileName: string;
      contentType: string;
      sizeBytes: number;
    };
    return (
      <DocumentUploadedCard
        taskId={p.taskId}
        documentId={p.documentId}
        fileName={p.fileName}
        sizeBytes={p.sizeBytes}
        customerId={customerId}
        surface={surface}
        onSelectDocument={onSelectDocument}
        onSelectTask={onSelectTask}
      />
    );
  }

  return (
    <div className="rounded-md border border-line bg-card-tint/60 px-3 py-2 text-[11px] text-ink-3">
      Unsupported card type: {cardType}
    </div>
  );
}

function DocumentUploadedCard({
  taskId,
  documentId,
  fileName,
  sizeBytes,
  customerId,
  surface,
  onSelectDocument,
  onSelectTask,
}: {
  taskId: Id<"tasks">;
  documentId: Id<"documents">;
  fileName: string;
  sizeBytes: number;
  customerId: Id<"customers">;
  surface: CardSurface;
  onSelectDocument?: (
    documentId: Id<"documents">,
    taskId: Id<"tasks">,
  ) => void;
  onSelectTask?: (taskId: Id<"tasks">) => void;
}) {
  const downloadUrl = useQuery(api.documents.getDownloadUrl, { documentId });
  return (
    <div className="rounded-lg border border-line bg-card-tint/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-fmu-green" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fmu-green">
          Document attached
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        {onSelectDocument ? (
          <button
            type="button"
            onClick={() => onSelectDocument(documentId, taskId)}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink hover:text-fmu-navy hover:underline"
          >
            {fileName}
          </button>
        ) : downloadUrl ? (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-fmu-navy hover:underline"
          >
            {fileName}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {fileName}
          </span>
        )}
        <span className="num shrink-0 text-[11px] text-ink-4">
          {formatBytes(sizeBytes)}
        </span>
      </div>
      {onSelectTask ? (
        <button
          type="button"
          onClick={() => onSelectTask(taskId)}
          className="mt-1 inline-block text-[11px] text-ink-3 hover:text-fmu-navy hover:underline"
        >
          View task
        </button>
      ) : (
        <Link
          href={taskHref(surface, customerId, taskId)}
          prefetch={false}
          className="mt-1 inline-block text-[11px] text-ink-3 hover:text-fmu-navy hover:underline"
        >
          View task
        </Link>
      )}
    </div>
  );
}

