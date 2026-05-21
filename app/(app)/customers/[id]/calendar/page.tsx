"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Calendar as CalendarIcon,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { NewEventDialog } from "@/components/calendar/new-event-dialog";
import { cn } from "@/lib/utils";

export default function CustomerCalendarPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;
  const items = useQuery(api.calendar.upcomingForCustomer, { customerId });
  const [dialogOpen, setDialogOpen] = useState(false);

  const grouped = useMemo(() => groupByDate(items ?? []), [items]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Calendar
        </h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New event
        </Button>
      </div>

      <NewEventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        fixedCustomerId={customerId}
      />

      {items === undefined && (
        <p className="text-sm text-ink-3">Loading…</p>
      )}
      {items !== undefined && items.length === 0 && (
        <p className="text-sm text-ink-3">Nothing scheduled.</p>
      )}

      {items !== undefined && items.length > 0 && (
        <div className="space-y-6">
          {grouped.map((g) => (
            <DateGroup key={g.dateKey} group={g} customerId={customerId} />
          ))}
        </div>
      )}
    </div>
  );
}

type CalendarItem = NonNullable<
  ReturnType<typeof useQuery<typeof api.calendar.upcomingForCustomer>>
>[number];

type Group = {
  dateKey: string;
  label: string;
  isPast: boolean;
  items: CalendarItem[];
};

function groupByDate(items: CalendarItem[]): Group[] {
  const map = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const key = toDateKey(it.start);
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  const today = toDateKey(Date.now());
  const tomorrow = toDateKey(Date.now() + 24 * 60 * 60 * 1000);
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({
      dateKey: key,
      label:
        key === today
          ? "Today"
          : key === tomorrow
            ? "Tomorrow"
            : formatHeading(key),
      isPast: key < today,
      items: list,
    }));
}

function DateGroup({
  group,
  customerId,
}: {
  group: Group;
  customerId: Id<"customers">;
}) {
  return (
    <div className={cn("space-y-2", group.isPast && "opacity-60")}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">{group.label}</h2>
        <span className="text-xs text-ink-4">
          {group.items.length} {group.items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <ul className="divide-y divide-line">
          {group.items.map((item) => (
            <CalendarRow
              key={`${item.kind}-${String(item.id)}`}
              item={item}
              customerId={customerId}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CalendarRow({
  item,
  customerId,
}: {
  item: CalendarItem;
  customerId: Id<"customers">;
}) {
  const deleteEvent = useMutation(api.calendar.deleteEvent);

  const Icon = item.kind === "task" ? ListChecks : CalendarIcon;
  const href =
    item.kind === "task"
      ? `/customers/${customerId}/tasks/${item.id}`
      : "#";
  const time =
    item.kind === "event" && !item.allDay
      ? formatTime(item.start)
      : item.kind === "task"
        ? formatTime(item.start)
        : "All day";

  return (
    <li className="group flex items-center gap-3 px-4 py-3 hover:bg-card-tint">
      <span className="num w-16 shrink-0 text-xs text-ink-3">{time}</span>
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          item.kind === "task" ? "text-fmu-navy" : "text-ink-3",
        )}
      />
      {item.kind === "task" ? (
        <Link
          href={href}
          prefetch={false}
          className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-fmu-navy"
        >
          {item.title}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {item.title}
        </span>
      )}
      {item.kind === "event" && item.source === "manual" && (
        <button
          type="button"
          onClick={() =>
            void deleteEvent({ eventId: item.id }).catch(console.error)
          }
          className="text-ink-4 opacity-0 transition-opacity hover:text-fmu-red group-hover:opacity-100"
          aria-label="Delete event"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function toDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "numeric",
  }).format(new Date(ts));
}
