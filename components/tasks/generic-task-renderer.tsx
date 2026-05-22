"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Check,
  User as UserIcon,
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
import { TaskAttachments } from "@/components/tasks/task-attachments";
import { cn } from "@/lib/utils";

type Props = {
  task: Doc<"tasks">;
  customerId: Id<"customers">;
};

/**
 * Editorial task brief — the "first page of a case file."
 *
 *   masthead    (eyebrow caption · type · status-dot · status label)
 *   title       (h1)
 *   dateline    (Due · Assigned · Visibility — inline, no card)
 *   description (promoted; reads like a paragraph, not a form field)
 *   files       (single dropzone via TaskAttachments)
 *   actions     (primary + secondary status transitions, "Next:" hint)
 *   colophon    (created / id, ghosted mono)
 */
export function GenericTaskRenderer({ task, customerId }: Props) {
  const router = useRouter();
  const updateTask = useMutation(api.tasks.update);
  const setStatus = useMutation(api.tasks.setStatus);
  const archive = useMutation(api.tasks.archive);

  const isCancelled = task.status === "cancelled";
  const isApproved = task.status === "firm_approved";
  const payload = (task.payload ?? {}) as { description?: string };

  return (
    <article className="mx-auto w-full max-w-2xl px-8 py-10">
      {/* ── Masthead ──────────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <EyebrowRow type={task.type} status={task.status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Task actions">
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
        <InlineTitle
          value={task.title}
          disabled={isCancelled}
          onSave={(title) => updateTask({ taskId: task._id, title })}
        />
      </header>

      {/* ── Dateline / meta strip ──────────────────────── */}
      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2.5">
        <MetaCell label="Due">
          <DueDateInline
            value={task.dueDate}
            disabled={isCancelled}
            onSave={(dueDate) =>
              updateTask({ taskId: task._id, dueDate })
            }
          />
        </MetaCell>
        <MetaCell label="Assigned">
          <AssigneeInline
            value={task.assignedTo}
            disabled={isCancelled}
            onSave={(assignedTo) =>
              updateTask({ taskId: task._id, assignedTo })
            }
          />
        </MetaCell>
        <ClientVisibilityInline
          value={task.clientVisible}
          disabled={isCancelled}
          onToggle={() =>
            updateTask({
              taskId: task._id,
              clientVisible: !task.clientVisible,
            })
          }
        />
      </div>

      {/* ── Description ───────────────────────────────── */}
      <section className="mt-9 border-t border-line pt-7">
        <h2 className="eyebrow mb-2">Description</h2>
        <DescriptionField
          value={payload.description ?? ""}
          disabled={isCancelled}
          onSave={(description) =>
            updateTask({
              taskId: task._id,
              payload: { ...(task.payload ?? {}), description },
            })
          }
        />
      </section>

      {/* ── Files ─────────────────────────────────────── */}
      <section className="mt-9 border-t border-line pt-7">
        <TaskAttachments
          taskId={task._id}
          customerId={customerId}
          disabled={isCancelled}
          label={
            task.type === "core.document_request"
              ? "Requested documents"
              : "Files"
          }
          emptyHint="Drop files here, or use Add files."
        />
      </section>

      {/* ── Actions ───────────────────────────────────── */}
      {!isCancelled && (
        <section className="mt-9 border-t border-line pt-7">
          <StatusActions
            task={task}
            onSetStatus={(status) =>
              setStatus({ taskId: task._id, status })
            }
          />
        </section>
      )}

      {/* ── Audit footer ──────────────────────────────── */}
      <footer className="mt-12 flex items-center gap-3 text-[11px] text-ink-4">
        <span className="num">Created {formatDate(task._creationTime)}</span>
        <span>·</span>
        <span className="num">#{task._id.slice(-7)}</span>
      </footer>
    </article>
  );
}

// ── Masthead pieces ────────────────────────────────────────────────────

function statusTone(pill: string): { dot: string; text: string } {
  switch (pill) {
    case "completed":
    case "filed":
      return { dot: "bg-fmu-green", text: "text-fmu-green" };
    case "review":
    case "processing":
      return { dot: "bg-fmu-yellow", text: "text-ink-2" };
    case "blocked":
    case "failed":
      return { dot: "bg-fmu-red", text: "text-fmu-red" };
    case "draft":
      return { dot: "bg-ink-3", text: "text-ink-2" };
    case "neutral":
    default:
      return { dot: "bg-ink-4", text: "text-ink-3" };
  }
}

function EyebrowRow({
  type,
  status,
}: {
  type: string;
  status: Doc<"tasks">["status"];
}) {
  const { label, pill } = statusDisplay(status, type);
  const tone = statusTone(pill);
  return (
    <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
      <span>{typeDisplay(type)}</span>
      <span className="text-ink-4">·</span>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)}
        aria-hidden
      />
      <span className={tone.text}>{label}</span>
    </div>
  );
}

// ── Meta cell ──────────────────────────────────────────────────────────

function MetaCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-baseline gap-1.5 text-[13px]">
      <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-3">
        {label}
      </span>
      <span className="text-ink-2">{children}</span>
    </div>
  );
}

// ── Due date inline ────────────────────────────────────────────────────

function DueDateInline({
  value,
  disabled,
  onSave,
}: {
  value: number | undefined;
  disabled?: boolean;
  onSave: (dueDate: number | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="date"
          defaultValue={value ? toDateInputString(value) : ""}
          onBlur={(e) => {
            const v = e.target.value;
            if (v) {
              void onSave(new Date(v + "T23:59:59").getTime());
            }
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value;
              if (v) void onSave(new Date(v + "T23:59:59").getTime());
              setEditing(false);
            }
          }}
          className="num bg-transparent border-b border-line-2 focus:border-fmu-navy outline-none text-[13px] px-0 py-0.5"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              void onSave(null);
              setEditing(false);
            }}
            className="text-[11px] text-ink-3 hover:text-fmu-red"
          >
            clear
          </button>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={cn(
        "group inline-flex items-baseline gap-1",
        !disabled && "hover:text-ink",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      {value ? (
        <span className="num text-ink-2">{formatDate(value)}</span>
      ) : (
        <span className="italic text-ink-3">Add due date</span>
      )}
      {!disabled && (
        <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

// ── Assignee inline ────────────────────────────────────────────────────

function AssigneeInline({
  value,
  disabled,
  onSave,
}: {
  value: Id<"users"> | undefined;
  disabled?: boolean;
  onSave: (assignedTo: Id<"users"> | null) => Promise<unknown>;
}) {
  const members = useQuery(api.team.listMembers, {});
  const current = members?.find((m) => m.userId === value) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "group inline-flex items-baseline gap-1",
            !disabled && "hover:text-ink",
            disabled && "cursor-not-allowed opacity-70",
          )}
        >
          {current ? (
            <span className="text-ink-2">{current.displayName}</span>
          ) : (
            <span className="italic text-ink-3">Unassigned</span>
          )}
          {!disabled && (
            <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => void onSave(null)}>
          <UserIcon className="h-4 w-4 text-ink-4" />
          Unassigned
        </DropdownMenuItem>
        {members && members.length > 0 && <DropdownMenuSeparator />}
        {members?.map((m) => (
          <DropdownMenuItem
            key={m.membershipId}
            onSelect={() => void onSave(m.userId)}
          >
            <span className="text-sm">{m.displayName}</span>
            {m.userId === value && (
              <Check className="ml-auto h-3.5 w-3.5 text-fmu-green" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Client visibility inline ───────────────────────────────────────────

function ClientVisibilityInline({
  value,
  disabled,
  onToggle,
}: {
  value: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onToggle()}
      disabled={disabled}
      className={cn(
        "group inline-flex items-baseline gap-1.5 text-[13px]",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 self-center rounded-full transition-colors",
          value ? "bg-fmu-green" : "bg-ink-4",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "tracking-tight",
          value ? "text-fmu-green" : "text-ink-3",
          !disabled && "group-hover:underline",
        )}
      >
        {value ? "Shared with client" : "Internal only"}
      </span>
    </button>
  );
}

// ── Status actions ─────────────────────────────────────────────────────

function StatusActions({
  task,
  onSetStatus,
}: {
  task: Doc<"tasks">;
  onSetStatus: (
    status: "draft" | "review" | "firm_approved" | "cancelled",
  ) => Promise<unknown>;
}) {
  const isSimpleType =
    task.type === "core.todo" || task.type === "core.meeting";

  // Simple done/reopen flow.
  if (isSimpleType) {
    if (task.status === "draft") {
      return (
        <div className="flex items-center gap-2">
          <Button size="lg" onClick={() => void onSetStatus("firm_approved")}>
            Mark as done
          </Button>
        </div>
      );
    }
    if (task.status === "firm_approved") {
      return (
        <div className="flex items-center gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() => void onSetStatus("draft")}
          >
            <RotateCcw className="h-4 w-4" />
            Reopen
          </Button>
        </div>
      );
    }
    return null;
  }

  // Review-style flow: draft → review → firm_approved
  switch (task.status) {
    case "draft":
      return (
        <div className="flex flex-wrap items-center gap-3">
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
          <span className="ml-auto text-[11px] text-ink-3">
            Next: <span className="text-ink-2">In review</span>
          </span>
        </div>
      );
    case "review":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => void onSetStatus("firm_approved")}>
            Approve
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => void onSetStatus("draft")}
          >
            Back to draft
          </Button>
          <span className="ml-auto text-[11px] text-ink-3">
            Next: <span className="text-ink-2">Approved</span>
          </span>
        </div>
      );
    case "firm_approved":
      return (
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onSetStatus("review")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reopen
          </Button>
        </div>
      );
    default:
      return null;
  }
}

// ── Title (inline-editable) ────────────────────────────────────────────

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

// ── Description field — flat, no box ───────────────────────────────────

function DescriptionField({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (description: string) => Promise<unknown>;
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
        placeholder="What's this task about?"
        rows={5}
        className="w-full resize-y bg-transparent text-sm leading-relaxed text-ink outline-none border-b border-line-2 focus:border-fmu-navy py-1"
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
          "block w-full text-left text-sm italic leading-relaxed text-ink-3",
          !disabled && "hover:text-ink-2",
          disabled && "cursor-not-allowed opacity-70",
        )}
      >
        What's this task about? Add a description…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={cn(
        "group -mx-2 block w-full whitespace-pre-wrap rounded px-2 py-1 text-left text-sm leading-relaxed text-ink transition-colors",
        !disabled && "hover:bg-card-tint/40",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      {value}
    </button>
  );
}

// ── Formatters ─────────────────────────────────────────────────────────

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

