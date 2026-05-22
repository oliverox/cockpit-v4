"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { CalendarDays, ListChecks, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { statusDisplay, typeDisplay } from "@/lib/task-display";
import { Button } from "@/components/ui/button";
import { PortalNewTaskDialog } from "@/components/tasks/portal-new-task-dialog";
import { cn } from "@/lib/utils";

const OPEN_STATUSES = new Set([
  "draft",
  "blocked",
  "ingesting",
  "processing",
  "review",
]);

export default function PortalCustomerTasksPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId as Id<"customers">;
  const tasks = useQuery(api.tasks.listByCustomer, { customerId });
  const [newOpen, setNewOpen] = useState(false);

  const buckets = useMemo(() => bucket(tasks ?? []), [tasks]);
  const total = tasks?.length ?? 0;

  return (
    <div className="w-full px-8 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Tasks</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            What's on
          </h1>
          <p className="mt-2 text-sm text-ink-3">
            Things assigned to you, and things being waited on from you.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New task
        </Button>
      </header>
      <PortalNewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        customerId={customerId}
      />

      {tasks === undefined && (
        <div className="text-sm text-ink-3">Loading…</div>
      )}
      {tasks !== undefined && total === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-6 py-8 text-center">
          <ListChecks className="mx-auto mb-3 h-6 w-6 text-ink-4" />
          <p className="text-sm text-ink-3">Nothing assigned yet.</p>
        </div>
      )}
      {tasks !== undefined && total > 0 && (
        <div className="space-y-6">
          <Section
            title="Open"
            tasks={buckets.open}
            customerId={customerId}
            emptyText="Nothing to do right now."
          />
          {buckets.done.length > 0 && (
            <Section
              title="Done"
              tasks={buckets.done}
              customerId={customerId}
              dim
            />
          )}
        </div>
      )}
    </div>
  );
}

function bucket(tasks: Doc<"tasks">[]) {
  const open: Doc<"tasks">[] = [];
  const done: Doc<"tasks">[] = [];
  for (const t of tasks) {
    if (t.status === "cancelled") continue;
    if (OPEN_STATUSES.has(t.status)) open.push(t);
    else done.push(t);
  }
  open.sort((a, b) => {
    const ad = a.dueDate ?? Infinity;
    const bd = b.dueDate ?? Infinity;
    return ad - bd;
  });
  done.sort((a, b) => b._creationTime - a._creationTime);
  return { open, done };
}

function Section({
  title,
  tasks,
  customerId,
  emptyText,
  dim,
}: {
  title: string;
  tasks: Doc<"tasks">[];
  customerId: Id<"customers">;
  emptyText?: string;
  dim?: boolean;
}) {
  return (
    <section className={cn("space-y-2", dim && "opacity-70")}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          {title}
        </h2>
        <span className="text-[11px] text-ink-4">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-3 py-3 text-[12px] text-ink-3">
          {emptyText ?? "Nothing here."}
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
          {tasks.map((t) => (
            <li key={t._id}>
              <TaskRow task={t} customerId={customerId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({
  task,
  customerId,
}: {
  task: Doc<"tasks">;
  customerId: Id<"customers">;
}) {
  const { label, pill } = statusDisplay(task.status, task.type);
  const isOverdue =
    task.dueDate !== undefined &&
    task.dueDate < Date.now() &&
    OPEN_STATUSES.has(task.status);

  return (
    <Link
      href={`/portal/c/${customerId}/tasks/${task._id}`}
      prefetch={false}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card-tint"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink group-hover:text-fmu-green">
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
          <span>{typeDisplay(task.type)}</span>
          {task.dueDate && (
            <>
              <span className="text-ink-4">·</span>
              <span
                className={cn(
                  "num inline-flex items-center gap-1",
                  isOverdue && "text-fmu-red",
                )}
              >
                <CalendarDays className="h-3 w-3" />
                {formatDue(task.dueDate)}
              </span>
            </>
          )}
        </div>
      </div>
      <span className={`pill pill--${pill} shrink-0`}>{label}</span>
    </Link>
  );
}

function formatDue(ts: number): string {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.round((ts - now) / day);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0 && days < 7) return `in ${days}d`;
  if (days < 0 && days > -30) return `${-days}d ago`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(ts));
}
