"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskAttachments } from "@/components/tasks/task-attachments";
import { statusDisplay, typeDisplay } from "@/lib/task-display";

/**
 * Client-side task view. Read-only details + the file attachment widget so
 * clients can fulfil document requests (or attach files to any task the firm
 * has shared with them). Task workflow controls (status moves, archive,
 * edit) stay on the firm side.
 */
export default function PortalTaskDetailPage() {
  const params = useParams<{ customerId: string; taskId: string }>();
  const customerId = params.customerId as Id<"customers">;
  const taskId = params.taskId as Id<"tasks">;

  const task = useQuery(api.tasks.get, { taskId });

  if (task === undefined) {
    return (
      <div className="w-full px-8 py-8 text-sm text-ink-3">Loading…</div>
    );
  }
  if (task === null) {
    return (
      <div className="w-full px-8 py-8 text-sm text-ink-3">
        Task not found.
      </div>
    );
  }

  const { label: statusLabel, pill } = statusDisplay(task.status, task.type);
  const description =
    (task.payload as { description?: string } | null | undefined)
      ?.description ?? "";

  return (
    <div className="w-full space-y-7 px-8 py-8">
      <div>
        <Link
          href={`/portal/c/${customerId}/tasks`}
          prefetch={false}
          className="mb-3 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
        >
          <ArrowLeft className="h-3 w-3" />
          All tasks
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="eyebrow">{typeDisplay(task.type)}</div>
          <span className={`pill pill--${pill}`}>{statusLabel}</span>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          {task.title}
        </h1>
        {task.dueDate && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
            <CalendarDays className="h-3 w-3" />
            <span className="num">Due {formatDate(task.dueDate)}</span>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="eyebrow">Description</div>
          {description ? (
            <div className="whitespace-pre-wrap rounded-lg border border-line bg-card p-4 text-sm text-ink-2">
              {description}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-4 py-4 text-sm text-ink-3">
              No description.
            </div>
          )}
        </section>

        <TaskAttachments
          taskId={taskId}
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
    </div>
  );
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}
