"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarDays,
  Download,
  ExternalLink,
  FileText,
  Inbox,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { statusDisplay, typeDisplay } from "@/lib/task-display";
import { TaskAttachments } from "@/components/tasks/task-attachments";
import { cn } from "@/lib/utils";

export type ChatSelection =
  | { kind: "task"; taskId: Id<"tasks"> }
  | {
      kind: "document";
      documentId: Id<"documents">;
      taskId: Id<"tasks"> | null;
    }
  | null;

type Surface = "firm" | "portal";

type Props = {
  selection: ChatSelection;
  customerId: Id<"customers">;
  surface: Surface;
  onClear: () => void;
};

/**
 * Right-side context panel in the chat. Master-detail companion: the chat
 * lives on the left, this panel reacts to clicks on tasks and documents
 * within the conversation.
 */
export function ChatContextPanel({
  selection,
  customerId,
  surface,
  onClear,
}: Props) {
  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-card">
      {selection === null ? (
        <EmptyState />
      ) : selection.kind === "task" ? (
        <TaskContext
          taskId={selection.taskId}
          customerId={customerId}
          surface={surface}
          onClear={onClear}
        />
      ) : (
        <DocumentContext
          documentId={selection.documentId}
          taskId={selection.taskId}
          customerId={customerId}
          surface={surface}
          onClear={onClear}
        />
      )}
    </aside>
  );
}

// ── Empty state ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Inbox className="h-6 w-6 text-ink-4" />
      <p className="max-w-xs text-sm text-ink-3">
        Click a task or document in the conversation to see its details here.
      </p>
    </div>
  );
}

// ── Task ───────────────────────────────────────────────────────────────

function TaskContext({
  taskId,
  customerId,
  surface,
  onClear,
}: {
  taskId: Id<"tasks">;
  customerId: Id<"customers">;
  surface: Surface;
  onClear: () => void;
}) {
  const task = useQuery(api.tasks.get, { taskId });
  const fullHref =
    surface === "portal"
      ? `/portal/c/${customerId}/tasks/${taskId}`
      : `/customers/${customerId}/tasks/${taskId}`;

  return (
    <>
      <PanelHeader
        eyebrow="Task"
        title={task?.title}
        onClear={onClear}
        right={
          <Link
            href={fullHref}
            prefetch={false}
            className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-fmu-navy"
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {task === undefined && (
          <div className="text-sm text-ink-3">Loading…</div>
        )}
        {task === null && (
          <div className="text-sm text-ink-3">Task not found.</div>
        )}
        {task && (
          <TaskBody task={task} customerId={customerId} />
        )}
      </div>
    </>
  );
}

function TaskBody({
  task,
  customerId,
}: {
  task: Doc<"tasks">;
  customerId: Id<"customers">;
}) {
  const { label, pill } = statusDisplay(task.status, task.type);
  const description =
    (task.payload as { description?: string } | null | undefined)
      ?.description ?? "";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">{typeDisplay(task.type)}</span>
        <span className={`pill pill--${pill}`}>{label}</span>
      </div>
      {task.dueDate && (
        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <CalendarDays className="h-3 w-3" />
          <span className="num">Due {formatDate(task.dueDate)}</span>
        </div>
      )}
      {description && (
        <section className="space-y-1.5">
          <div className="eyebrow">Description</div>
          <div className="whitespace-pre-wrap rounded-md border border-line bg-card-tint/40 p-3 text-sm text-ink-2">
            {description}
          </div>
        </section>
      )}
      <TaskAttachments
        taskId={task._id}
        customerId={customerId}
        label={
          task.type === "core.document_request"
            ? "Requested documents"
            : "Attached files"
        }
        emptyHint={
          task.type === "core.document_request"
            ? "Drop the requested files here, or use Add files."
            : "Drop files here, or use Add files."
        }
      />
    </div>
  );
}

// ── Document ───────────────────────────────────────────────────────────

function DocumentContext({
  documentId,
  taskId,
  customerId,
  surface,
  onClear,
}: {
  documentId: Id<"documents">;
  taskId: Id<"tasks"> | null;
  customerId: Id<"customers">;
  surface: Surface;
  onClear: () => void;
}) {
  const downloadUrl = useQuery(api.documents.getDownloadUrl, { documentId });
  const taskHref =
    taskId &&
    (surface === "portal"
      ? `/portal/c/${customerId}/tasks/${taskId}`
      : `/customers/${customerId}/tasks/${taskId}`);

  return (
    <>
      <PanelHeader eyebrow="Document" title="" onClear={onClear} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-card p-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-fmu-green" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">
                {downloadUrl ? "Click below to download" : "Loading…"}
              </div>
              <div className="num mt-0.5 text-[11px] text-ink-3">
                {documentId}
              </div>
            </div>
          </div>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2 text-sm font-medium text-ink hover:border-fmu-navy hover:text-fmu-navy"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          )}
          {taskHref && (
            <div>
              <Link
                href={taskHref}
                prefetch={false}
                className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-fmu-navy"
              >
                View task
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Header ─────────────────────────────────────────────────────────────

function PanelHeader({
  eyebrow,
  title,
  onClear,
  right,
}: {
  eyebrow: string;
  title?: string;
  onClear: () => void;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="eyebrow">{eyebrow}</div>
        {title && (
          <h3 className="mt-0.5 truncate text-base font-semibold text-ink">
            {title}
          </h3>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {right}
        <button
          type="button"
          onClick={onClear}
          aria-label="Close panel"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md",
            "text-ink-4 hover:bg-card-tint hover:text-ink",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}
