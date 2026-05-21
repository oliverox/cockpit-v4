"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { statusDisplay, typeDisplay } from "@/lib/task-display";
import { cn } from "@/lib/utils";

type Props = {
  task: Doc<"tasks">;
  customerId: Id<"customers">;
};

/**
 * Fallback renderer used when the task's type has no custom UI registered
 * in the module registry. Handles all four core.* types in Phase 1.3
 * (todo, document_request, review, meeting) as a single shape:
 *
 *   - Editable title
 *   - Status pill + transition buttons (next legal status)
 *   - Editable due date
 *   - Editable notes (lives in payload.notes)
 *   - Archive in overflow menu
 */
export function GenericTaskRenderer({ task, customerId }: Props) {
  const router = useRouter();
  const updateTask = useMutation(api.tasks.update);
  const setStatus = useMutation(api.tasks.setStatus);
  const archive = useMutation(api.tasks.archive);

  const { label: statusLabel, pill: statusPill } = statusDisplay(
    task.status,
    task.type,
  );
  const isCancelled = task.status === "cancelled";
  const isApproved = task.status === "firm_approved";
  const payload = (task.payload ?? {}) as { notes?: string };

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="eyebrow">{typeDisplay(task.type)}</div>
            <span className={`pill pill--${statusPill}`}>{statusLabel}</span>
          </div>
          <InlineTitle
            value={task.title}
            disabled={isCancelled}
            onSave={(title) => updateTask({ taskId: task._id, title })}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Task actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {isApproved && (
              <DropdownMenuItem
                onSelect={() =>
                  void setStatus({ taskId: task._id, status: "draft" })
                }
              >
                <RotateCcw className="h-4 w-4" />
                Reopen
              </DropdownMenuItem>
            )}
            {!isApproved && !isCancelled && task.status !== "draft" && (
              <DropdownMenuItem
                onSelect={() =>
                  void setStatus({ taskId: task._id, status: "draft" })
                }
              >
                <RotateCcw className="h-4 w-4" />
                Back to draft
              </DropdownMenuItem>
            )}
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
                onSelect={async () => {
                  await archive({ taskId: task._id });
                  router.push(`/customers/${customerId}/tasks`);
                }}
                className="text-fmu-red focus:text-fmu-red"
              >
                <Archive className="h-4 w-4" />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Primary action: status transition */}
      {!isCancelled && (
        <StatusActions
          task={task}
          onSetStatus={(status) => setStatus({ taskId: task._id, status })}
        />
      )}

      {/* Details */}
      <section className="overflow-hidden rounded-lg border border-line bg-card">
        <DetailRow label="Due date">
          <DueDateField
            value={task.dueDate}
            disabled={isCancelled}
            onSave={(dueDate) =>
              updateTask({ taskId: task._id, dueDate })
            }
          />
        </DetailRow>
        <DetailRow label="Visible to client">
          <button
            type="button"
            disabled={isCancelled}
            onClick={() =>
              updateTask({
                taskId: task._id,
                clientVisible: !task.clientVisible,
              })
            }
            className={cn(
              "text-sm",
              task.clientVisible ? "text-fmu-green font-medium" : "text-ink-3",
              !isCancelled && "hover:text-ink",
              isCancelled && "cursor-not-allowed opacity-60",
            )}
          >
            {task.clientVisible ? "Yes" : "No"}
          </button>
        </DetailRow>
        <DetailRow label="Created" last>
          <span className="num text-sm text-ink-3">
            {formatDate(task._creationTime)}
          </span>
        </DetailRow>
      </section>

      {/* Notes */}
      <section className="space-y-2">
        <div className="eyebrow">Notes</div>
        <NotesField
          value={payload.notes ?? ""}
          disabled={isCancelled}
          onSave={(notes) =>
            updateTask({
              taskId: task._id,
              payload: { ...(task.payload ?? {}), notes },
            })
          }
        />
      </section>
    </div>
  );
}

// ---- Status actions -----------------------------------------------------

function StatusActions({
  task,
  onSetStatus,
}: {
  task: Doc<"tasks">;
  onSetStatus: (
    status:
      | "draft"
      | "review"
      | "firm_approved"
      | "cancelled",
  ) => Promise<unknown>;
}) {
  const isSimpleDone =
    (task.type === "core.todo" || task.type === "core.meeting") &&
    task.status === "draft";
  const isSimpleReopen =
    (task.type === "core.todo" || task.type === "core.meeting") &&
    task.status === "firm_approved";

  if (isSimpleDone) {
    return (
      <Button
        size="lg"
        onClick={() => void onSetStatus("firm_approved")}
      >
        Mark as done
      </Button>
    );
  }
  if (isSimpleReopen) {
    return (
      <Button
        size="lg"
        variant="outline"
        onClick={() => void onSetStatus("draft")}
      >
        <RotateCcw className="h-4 w-4" />
        Reopen
      </Button>
    );
  }

  // Review-style flow: draft → review → firm_approved
  switch (task.status) {
    case "draft":
      return (
        <div className="flex gap-2">
          <Button size="lg" onClick={() => void onSetStatus("review")}>
            Send for review
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => void onSetStatus("firm_approved")}
          >
            Mark complete
          </Button>
        </div>
      );
    case "review":
      return (
        <div className="flex gap-2">
          <Button
            size="lg"
            onClick={() => void onSetStatus("firm_approved")}
          >
            Approve
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => void onSetStatus("draft")}
          >
            Back to draft
          </Button>
        </div>
      );
    case "firm_approved":
      return (
        <Button
          size="lg"
          variant="outline"
          onClick={() => void onSetStatus("review")}
        >
          <RotateCcw className="h-4 w-4" />
          Reopen
        </Button>
      );
    default:
      return null;
  }
}

// ---- Field components --------------------------------------------------

function DetailRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[160px_1fr] items-center gap-4 px-6 py-3",
        !last && "border-b border-line",
      )}
    >
      <div className="text-xs uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function InlineTitle({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (title: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      console.error(err);
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        autoFocus
        disabled={saving}
        maxLength={300}
        className="h-auto rounded-md border-line-2 px-3 py-1 text-3xl font-semibold tracking-tight text-ink"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={cn(
        "group -mx-3 -my-1 inline-flex max-w-full items-center gap-2 truncate rounded-md px-3 py-1 text-left text-3xl font-semibold tracking-tight text-ink",
        !disabled && "hover:bg-card-tint",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <span className="truncate">{value}</span>
      {!disabled && (
        <Pencil className="h-4 w-4 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

function DueDateField({
  value,
  onSave,
  disabled,
}: {
  value: number | undefined;
  onSave: (dueDate: number | null) => Promise<unknown>;
  disabled?: boolean;
}) {
  const dateStr = value ? toDateInputString(value) : "";
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={dateStr}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          // Treat as end-of-day local time so the date displays right
          // regardless of timezone shenanigans.
          const ts = new Date(v + "T23:59:59").getTime();
          void onSave(ts);
        }}
        className="rounded-md border border-line bg-card px-2 py-1 text-sm text-ink outline-none focus:border-fmu-navy disabled:cursor-not-allowed disabled:opacity-60"
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => void onSave(null)}
          className="text-xs text-ink-3 hover:text-fmu-red"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function NotesField({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (notes: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    if (draft === value) {
      setEditing(false);
      return;
    }
    try {
      await onSave(draft);
    } catch (err) {
      console.error(err);
      setDraft(value);
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void commit();
          }
        }}
        autoFocus
        disabled={disabled}
        placeholder="Anything worth remembering…"
        rows={6}
        className="w-full resize-y rounded-md border border-line-2 bg-card p-3 text-sm text-ink outline-none focus:border-fmu-navy"
      />
    );
  }

  if (!value.trim()) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        className={cn(
          "w-full rounded-md border border-dashed border-line-2 bg-card-tint/40 p-3 text-left text-sm text-ink-3",
          !disabled && "hover:border-line-2 hover:text-ink-2",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        Add notes…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={cn(
        "w-full whitespace-pre-wrap rounded-md border border-transparent bg-card p-3 text-left text-sm text-ink",
        !disabled && "hover:border-line",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      {value}
    </button>
  );
}

// ---- formatters --------------------------------------------------------

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}

function toDateInputString(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
