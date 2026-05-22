"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
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

/**
 * Lightweight task-creation dialog for the client portal.
 *
 * Backend caps client actors to `core.todo` — see `tasks.create` in
 * `convex/tasks.ts`. No type picker, no scope; just title + optional
 * due date. The task is created with `clientVisible: true` (enforced
 * server-side) so the firm sees the card in the shared conversation.
 */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: Id<"customers">;
};

export function PortalNewTaskDialog({ open, onOpenChange, customerId }: Props) {
  const router = useRouter();
  const createTask = useMutation(api.tasks.create);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setTitle("");
      setDueDate("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const canSubmit = title.trim().length > 0 && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const dueTs = dueDate
        ? new Date(dueDate + "T23:59:59").getTime()
        : undefined;
      const taskId = await createTask({
        customerId,
        moduleId: "core",
        type: "core.todo",
        title: title.trim(),
        dueDate: dueTs,
        clientVisible: true,
      });
      onOpenChange(false);
      router.push(`/portal/c/${customerId}/tasks/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Add a task or request your firm needs to see. They'll get this in
            the shared conversation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="portal-new-task-title">What do you need?</Label>
            <Input
              id="portal-new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Help me get my March payroll right"
              autoFocus
              disabled={submitting}
              required
              maxLength={300}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="portal-new-task-due">Due date (optional)</Label>
            <Input
              id="portal-new-task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-md border border-fmu-red/30 bg-fmu-red/5 px-3 py-2 text-[12px] text-fmu-red">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
