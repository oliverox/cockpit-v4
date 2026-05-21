"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Plus,
  RotateCcw,
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
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { statusDisplay, typeDisplay } from "@/lib/task-display";
import { cn } from "@/lib/utils";

export default function CustomerTasksPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;
  const tasks = useQuery(api.tasks.listByCustomer, { customerId });
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Tasks
        </h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New task
        </Button>
      </div>

      <NewTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customerId={customerId}
      />

      {tasks === undefined && (
        <p className="text-sm text-ink-3">Loading…</p>
      )}

      {tasks !== undefined && tasks.length === 0 && (
        <p className="text-sm text-ink-3">No tasks yet.</p>
      )}

      {tasks !== undefined && tasks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <TaskRow key={t._id} task={t} customerId={customerId} />
            ))}
          </ul>
        </div>
      )}
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
  const setStatus = useMutation(api.tasks.setStatus);
  const archive = useMutation(api.tasks.archive);

  const isCompletable =
    task.type === "core.todo" || task.type === "core.meeting";
  const isDone = task.status === "firm_approved";
  const isCancelled = task.status === "cancelled";

  async function toggleDone() {
    await setStatus({
      taskId: task._id,
      status: isDone ? "draft" : "firm_approved",
    });
  }

  const { label, pill } = statusDisplay(task.status, task.type);

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 hover:bg-card-tint",
        isCancelled && "opacity-60",
      )}
    >
      {isCompletable && !isCancelled && (
        <button
          type="button"
          onClick={() => void toggleDone()}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            isDone
              ? "border-fmu-green bg-fmu-green text-white"
              : "border-line-2 hover:border-ink-3",
          )}
          aria-label={isDone ? "Mark as open" : "Mark as done"}
        >
          {isDone && <Check />}
        </button>
      )}
      {(!isCompletable || isCancelled) && (
        <span
          className="h-5 w-5 shrink-0 rounded-full border border-line-2"
          aria-hidden
        />
      )}

      <Link
        href={`/customers/${customerId}/tasks/${task._id}`}
        prefetch={false}
        className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-fmu-navy"
      >
        <span
          className={cn(
            "truncate",
            isDone && "text-ink-3 line-through decoration-ink-4",
          )}
        >
          {task.title}
        </span>
      </Link>

      <span className="hidden text-xs text-ink-3 sm:inline">
        {typeDisplay(task.type)}
      </span>

      <span className={`pill pill--${pill}`}>{label}</span>

      {task.dueDate && (
        <span className="num hidden text-xs text-ink-3 md:inline">
          {formatDate(task.dueDate)}
        </span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Task actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {isDone ? (
            <DropdownMenuItem
              onSelect={() =>
                void setStatus({ taskId: task._id, status: "draft" })
              }
            >
              <RotateCcw className="h-4 w-4" />
              Reopen
            </DropdownMenuItem>
          ) : !isCancelled ? (
            <DropdownMenuItem
              onSelect={() =>
                void setStatus({
                  taskId: task._id,
                  status: "firm_approved",
                })
              }
            >
              <Check />
              Mark as done
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {isCancelled ? (
            <DropdownMenuItem
              onSelect={() =>
                void setStatus({ taskId: task._id, status: "draft" })
              }
            >
              <ArchiveRestore className="h-4 w-4" />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => void archive({ taskId: task._id })}
              className="text-fmu-red focus:text-fmu-red"
            >
              <Archive className="h-4 w-4" />
              Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function Check() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1.5,5.5 4,8 8.5,2.5" />
    </svg>
  );
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(ts));
}
