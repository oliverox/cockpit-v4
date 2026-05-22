"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarDays,
  FileText,
  ListChecks,
  Plus,
  Upload,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { statusDisplay, typeDisplay } from "@/lib/task-display";
import { Button } from "@/components/ui/button";
import { PortalNewTaskDialog } from "@/components/tasks/portal-new-task-dialog";
import {
  CalendarView,
  useCalendarMode,
} from "@/components/calendar/calendar-view";
import { cn } from "@/lib/utils";

const OPEN_STATUSES = new Set([
  "draft",
  "blocked",
  "ingesting",
  "processing",
  "review",
]);

export default function PortalCustomerHome() {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId as Id<"customers">;

  const customer = useQuery(api.customers.get, { customerId });
  const tasks = useQuery(api.tasks.listByCustomer, { customerId });
  const docs = useQuery(api.documents.listByCustomer, { customerId });
  const calendarItems = useQuery(api.calendar.upcomingForCustomer, {
    customerId,
    days: 120,
  });
  const [newOpen, setNewOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useCalendarMode("month");
  const [calendarCursor, setCalendarCursor] = useState<number>(() =>
    Date.now(),
  );

  const openTasks = useMemo(() => {
    const list = (tasks ?? []).filter((t) => OPEN_STATUSES.has(t.status));
    list.sort((a, b) => {
      const ad = a.dueDate ?? Infinity;
      const bd = b.dueDate ?? Infinity;
      return ad - bd;
    });
    return list;
  }, [tasks]);

  const recentDocs = useMemo(
    () => (docs ?? []).slice(0, 5),
    [docs],
  );

  return (
    <div className="w-full space-y-6 px-8 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Welcome</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            {customer?.name ?? "…"}
          </h1>
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

      <div className="grid h-[calc(100vh-12rem)] min-h-[640px] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0">
          <CalendarView
            items={calendarItems}
            mode={calendarMode}
            onModeChange={setCalendarMode}
            cursor={calendarCursor}
            onCursorChange={setCalendarCursor}
            hideCustomerLabel
            surface="portal"
          />
        </div>

        <div className="grid min-h-0 grid-rows-2 gap-4">
          <Panel
            title="What's on"
            count={openTasks.length}
            allHref={`/portal/c/${customerId}/tasks`}
          >
            {tasks === undefined ? (
              <Loading />
            ) : openTasks.length === 0 ? (
              <EmptyCard icon={ListChecks}>
                Nothing waiting on you right now.
              </EmptyCard>
            ) : (
              <ul className="divide-y divide-line">
                {openTasks.slice(0, 8).map((t) => (
                  <li key={t._id}>
                    <TaskRow task={t} customerId={customerId} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Recent files"
            count={docs?.length ?? 0}
            allHref={`/portal/c/${customerId}/documents`}
          >
            {docs === undefined ? (
              <Loading />
            ) : recentDocs.length === 0 ? (
              <EmptyCard icon={FileText}>No files shared yet.</EmptyCard>
            ) : (
              <ul className="divide-y divide-line">
                {recentDocs.map((d) => (
                  <li key={d._id}>
                    <DocRow doc={d} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  count,
  allHref,
  children,
}: {
  title: string;
  count: number;
  allHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-card">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
            {title}
          </h2>
          {count > 0 && (
            <span className="text-[11px] text-ink-4">{count}</span>
          )}
        </div>
        <Link
          href={allHref}
          prefetch={false}
          className="inline-flex items-center gap-0.5 text-[11px] text-ink-3 hover:text-fmu-green"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function Loading() {
  return <div className="px-4 py-4 text-sm text-ink-3">Loading…</div>;
}

// ── Pieces ─────────────────────────────────────────────────────────────

function EmptyCard({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <Icon className="h-5 w-5 text-ink-4" />
      <p className="text-[12px] text-ink-3">{children}</p>
    </div>
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
  const isRequest = task.type === "core.document_request";
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
      {isRequest ? (
        <Upload className="h-3.5 w-3.5 shrink-0 text-fmu-green" />
      ) : (
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-ink-3" />
      )}
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

function DocRow({ doc }: { doc: Doc<"documents"> }) {
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

// ── Formatters ─────────────────────────────────────────────────────────

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

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
