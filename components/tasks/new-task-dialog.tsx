"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import {
  ArrowRight,
  CalendarDays,
  FileCheck,
  FileUp,
  ListChecks,
} from "lucide-react";
import type { ComponentType } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type TaskTypeOption = {
  type: string;
  moduleId: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  defaultClientVisible: boolean;
};

const TASK_TYPE_OPTIONS: TaskTypeOption[] = [
  {
    type: "core.todo",
    moduleId: "core",
    label: "Todo",
    description: "A simple task with a title and optional due date.",
    icon: ListChecks,
    defaultClientVisible: false,
  },
  {
    type: "core.document_request",
    moduleId: "core",
    label: "Document request",
    description: "Ask the client to upload a specific document.",
    icon: FileUp,
    defaultClientVisible: true,
  },
  {
    type: "core.review",
    moduleId: "core",
    label: "Review",
    description: "Ask someone to look over and approve something.",
    icon: FileCheck,
    defaultClientVisible: true,
  },
  {
    type: "core.meeting",
    moduleId: "core",
    label: "Meeting",
    description: "Schedule a meeting and capture notes.",
    icon: CalendarDays,
    defaultClientVisible: false,
  },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: Id<"customers">;
  /** Optional callback fired with the new task id after a successful create. */
  onCreated?: (taskId: Id<"tasks">) => void;
};

export function NewTaskDialog({
  open,
  onOpenChange,
  customerId,
  onCreated,
}: Props) {
  const router = useRouter();
  const createTask = useMutation(api.tasks.create);

  const [selectedType, setSelectedType] = useState<TaskTypeOption>(
    TASK_TYPE_OPTIONS[0],
  );
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedType(TASK_TYPE_OPTIONS[0]);
    setTitle("");
    setSubmitting(false);
    setError(null);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const taskId = await createTask({
        customerId,
        moduleId: selectedType.moduleId,
        type: selectedType.type,
        title: title.trim(),
        clientVisible: selectedType.defaultClientVisible,
      });
      onCreated?.(taskId);
      onOpenChange(false);
      router.push(`/customers/${customerId}/tasks/${taskId}`);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to create task",
      );
      setSubmitting(false);
    }
  }

  const canSubmit = title.trim().length > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <form onSubmit={onSubmit}>
          <DialogHeader className="space-y-3 border-b border-line px-7 pt-7 pb-5">
            <div className="space-y-1.5">
              <DialogTitle className="text-2xl font-semibold tracking-tight text-ink">
                New task
              </DialogTitle>
              <DialogDescription className="text-sm text-ink-3">
                Pick a type, give it a title.
              </DialogDescription>
            </div>
            <div className="h-[3px] w-8 bg-fmu-yellow" aria-hidden />
          </DialogHeader>

          <div className="space-y-6 px-7 py-6">
            <div className="space-y-2">
              <Label className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
                Type
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {TASK_TYPE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = selectedType.type === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setSelectedType(opt)}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-all",
                        isSelected
                          ? "border-fmu-navy bg-fmu-navy/[0.04] shadow-[0_0_0_1px] shadow-fmu-navy"
                          : "border-line bg-card hover:border-line-2 hover:bg-card-tint",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          isSelected ? "text-fmu-navy" : "text-ink-3",
                        )}
                      />
                      <div className="text-sm font-semibold text-ink">
                        {opt.label}
                      </div>
                      <div className="text-xs text-ink-3 leading-relaxed">
                        {opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="task-title"
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
              >
                Title
              </Label>
              <Input
                id="task-title"
                placeholder={titlePlaceholder(selectedType.type)}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                autoFocus
                maxLength={300}
                required
                className="h-12 text-base"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-fmu-red/25 bg-fmu-red/[0.04] px-3 py-2.5 text-sm text-fmu-red"
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-line bg-card-tint/40 px-7 py-4">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="xl"
              disabled={!canSubmit}
              className="group min-w-[160px]"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current/70" />
                  Creating…
                </span>
              ) : (
                <>
                  Create task
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function titlePlaceholder(type: string) {
  switch (type) {
    case "core.todo":
      return "Follow up on March receipts";
    case "core.document_request":
      return "Upload March bank statement";
    case "core.review":
      return "Review Q1 VAT return draft";
    case "core.meeting":
      return "Year-end planning";
    default:
      return "Task title";
  }
}
