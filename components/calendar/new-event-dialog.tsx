"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the customer is pre-selected and the picker is hidden. */
  fixedCustomerId?: Id<"customers">;
};

export function NewEventDialog({
  open,
  onOpenChange,
  fixedCustomerId,
}: Props) {
  const createEvent = useMutation(api.calendar.createEvent);
  const customers = useQuery(api.customers.list, {});

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [customerId, setCustomerId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDate(toDateInputString(Date.now()));
    setTime("09:00");
    setAllDay(false);
    setCustomerId(fixedCustomerId ?? "");
    setSubmitting(false);
    setError(null);
  }, [open, fixedCustomerId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !date || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const startStr = allDay ? `${date}T00:00:00` : `${date}T${time || "09:00"}:00`;
      const start = new Date(startStr).getTime();
      await createEvent({
        title: title.trim(),
        start,
        allDay,
        customerId:
          customerId !== "" ? (customerId as Id<"customers">) : undefined,
        category: "custom",
      });
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Failed to create event",
      );
      setSubmitting(false);
    }
  }

  const canSubmit = title.trim().length > 0 && Boolean(date) && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        <form onSubmit={onSubmit}>
          <DialogHeader className="space-y-3 border-b border-line px-7 pt-7 pb-5">
            <div className="space-y-1.5">
              <DialogTitle className="text-2xl font-semibold tracking-tight text-ink">
                New event
              </DialogTitle>
              <DialogDescription className="text-sm text-ink-3">
                Manual calendar event.
              </DialogDescription>
            </div>
            <div className="h-[3px] w-8 bg-fmu-yellow" aria-hidden />
          </DialogHeader>

          <div className="space-y-4 px-7 py-6">
            <div className="space-y-2">
              <Label
                htmlFor="event-title"
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
              >
                Title
              </Label>
              <Input
                id="event-title"
                placeholder="Q1 VAT submission deadline"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                autoFocus
                maxLength={300}
                required
                className="h-11 text-base"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label
                  htmlFor="event-date"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
                >
                  Date
                </Label>
                <input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={submitting}
                  required
                  className="h-10 w-full rounded-md border border-line bg-card px-3 text-sm outline-none focus:border-fmu-navy"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="event-time"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
                >
                  Time
                </Label>
                <input
                  id="event-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={submitting || allDay}
                  className="h-10 w-full rounded-md border border-line bg-card px-3 text-sm outline-none focus:border-fmu-navy disabled:opacity-50"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                disabled={submitting}
              />
              All day
            </label>

            {!fixedCustomerId && (
              <div className="space-y-2">
                <Label
                  htmlFor="event-customer"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
                >
                  Customer (optional)
                </Label>
                <select
                  id="event-customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={submitting || customers === undefined}
                  className="h-10 w-full rounded-md border border-line bg-card px-3 text-sm outline-none focus:border-fmu-navy"
                >
                  <option value="">— No customer —</option>
                  {(customers ?? []).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
              className="group min-w-[140px]"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current/70" />
                  Creating…
                </span>
              ) : (
                <>
                  Create
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

function toDateInputString(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
