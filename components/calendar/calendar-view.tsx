"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Expand, Plus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

export type CalendarItem =
  | {
      kind: "event";
      id: Id<"calendar_events">;
      title: string;
      start: number;
      end: number | null;
      allDay: boolean;
      category:
        | "deadline"
        | "meeting"
        | "reminder"
        | "milestone"
        | "custom";
      customerId: Id<"customers"> | null;
      customerName: string | null;
      source: "manual" | "task" | "module";
    }
  | {
      kind: "task";
      id: Id<"tasks">;
      title: string;
      start: number;
      taskType: string;
      status: string;
      customerId: Id<"customers"> | null;
      customerName: string | null;
    };

export type CalendarMode = "month" | "week" | "agenda";

export type CalendarSurface = "firm" | "portal";

type Props = {
  items: CalendarItem[] | undefined;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  cursor: number;
  onCursorChange: (ts: number) => void;
  /** Hide the customer label on each item — used when scope is one customer. */
  hideCustomerLabel?: boolean;
  /** Which surface owns the calendar — controls task-link routing. */
  surface?: CalendarSurface;
  onNewEvent?: () => void;
  expandHref?: string;
};

// ── Component ──────────────────────────────────────────────────────────

export function CalendarView({
  items,
  mode,
  onModeChange,
  cursor,
  onCursorChange,
  hideCustomerLabel,
  surface = "firm",
  onNewEvent,
  expandHref,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-card">
      <Toolbar
        mode={mode}
        onModeChange={onModeChange}
        cursor={cursor}
        onCursorChange={onCursorChange}
        onNewEvent={onNewEvent}
        expandHref={expandHref}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "month" && (
          <MonthGrid
            items={items ?? []}
            cursor={cursor}
            hideCustomerLabel={hideCustomerLabel}
            surface={surface}
          />
        )}
        {mode === "week" && (
          <WeekGrid
            items={items ?? []}
            cursor={cursor}
            hideCustomerLabel={hideCustomerLabel}
            surface={surface}
          />
        )}
        {mode === "agenda" && (
          <AgendaList
            items={items ?? []}
            hideCustomerLabel={hideCustomerLabel}
            surface={surface}
          />
        )}
      </div>
    </div>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────

function Toolbar({
  mode,
  onModeChange,
  cursor,
  onCursorChange,
  onNewEvent,
  expandHref,
}: {
  mode: CalendarMode;
  onModeChange: (m: CalendarMode) => void;
  cursor: number;
  onCursorChange: (ts: number) => void;
  onNewEvent?: () => void;
  expandHref?: string;
}) {
  const label = useMemo(() => formatLabel(cursor, mode), [cursor, mode]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onCursorChange(stepCursor(cursor, mode, -1))}
          className="rounded-md p-1.5 text-ink-3 hover:bg-card-tint hover:text-ink"
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onCursorChange(stepCursor(cursor, mode, 1))}
          className="rounded-md p-1.5 text-ink-3 hover:bg-card-tint hover:text-ink"
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onCursorChange(Date.now())}
          className="mx-1 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 hover:border-line-2 hover:bg-card-tint"
        >
          Today
        </button>
        <h2 className="ml-2 text-base font-semibold tracking-tight text-ink">
          {label}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <ModeToggle mode={mode} onModeChange={onModeChange} />
        {onNewEvent && (
          <Button size="sm" onClick={onNewEvent}>
            <Plus className="h-3.5 w-3.5" />
            New event
          </Button>
        )}
        {expandHref && (
          <Link
            href={expandHref}
            prefetch={false}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink-2 hover:border-line-2 hover:bg-card-tint"
            aria-label="Open fullscreen calendar"
          >
            <Expand className="h-3.5 w-3.5" />
            Fullscreen
          </Link>
        )}
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: CalendarMode;
  onModeChange: (m: CalendarMode) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line">
      {(["month", "week", "agenda"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            mode === m
              ? "bg-fmu-navy text-white"
              : "bg-card text-ink-2 hover:bg-card-tint",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

// ── Month grid ─────────────────────────────────────────────────────────

function MonthGrid({
  items,
  cursor,
  hideCustomerLabel,
  surface,
}: {
  items: CalendarItem[];
  cursor: number;
  hideCustomerLabel?: boolean;
  surface: CalendarSurface;
}) {
  const cells = useMemo(() => buildMonthCells(cursor), [cursor]);
  const grouped = useMemo(() => groupByDay(items), [items]);

  return (
    <div className="flex h-full flex-col">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-line bg-card-tint">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3"
          >
            {d}
          </div>
        ))}
      </div>
      {/* Day cells — 6 rows, equal flex */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {cells.map((cell) => {
          const dayItems = grouped.get(cell.dateKey) ?? [];
          return (
            <DayCell
              key={cell.dateKey}
              cell={cell}
              items={dayItems}
              hideCustomerLabel={hideCustomerLabel}
              surface={surface}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  cell,
  items,
  hideCustomerLabel,
  surface,
}: {
  cell: MonthCell;
  items: CalendarItem[];
  hideCustomerLabel?: boolean;
  surface: CalendarSurface;
}) {
  const visible = items.slice(0, 3);
  const extra = items.length - visible.length;

  return (
    <div
      className={cn(
        "flex min-h-[96px] flex-col gap-1 border-b border-r border-line px-2 py-1.5 last:border-r-0",
        !cell.inMonth && "bg-card-tint/60",
        cell.isToday && "bg-fmu-navy/[0.025]",
      )}
    >
      <div className="flex items-baseline justify-between">
        <span
          className={cn(
            "num text-[12px] font-semibold tabular-nums",
            cell.isToday
              ? "rounded-full bg-fmu-navy px-1.5 py-0.5 text-white"
              : cell.inMonth
                ? "text-ink-2"
                : "text-ink-4",
          )}
        >
          {cell.day}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <ItemPill
            key={`${item.kind}-${String(item.id)}`}
            item={item}
            hideCustomerLabel={hideCustomerLabel}
            surface={surface}
          />
        ))}
        {extra > 0 && (
          <span className="px-1 text-[10px] font-medium text-ink-3">
            +{extra} more
          </span>
        )}
      </div>
    </div>
  );
}

// ── Week (lightweight 7-day stack) ─────────────────────────────────────

function WeekGrid({
  items,
  cursor,
  hideCustomerLabel,
  surface,
}: {
  items: CalendarItem[];
  cursor: number;
  hideCustomerLabel?: boolean;
  surface: CalendarSurface;
}) {
  const days = useMemo(() => buildWeekDays(cursor), [cursor]);
  const grouped = useMemo(() => groupByDay(items), [items]);

  return (
    <div className="grid h-full grid-cols-7 divide-x divide-line">
      {days.map((d) => {
        const dayItems = grouped.get(d.dateKey) ?? [];
        return (
          <div
            key={d.dateKey}
            className={cn(
              "flex h-full flex-col px-3 py-3",
              d.isToday && "bg-fmu-navy/[0.025]",
            )}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
                {WEEKDAYS[d.dayOfWeek]}
              </span>
              <span
                className={cn(
                  "num text-sm font-semibold",
                  d.isToday
                    ? "rounded-full bg-fmu-navy px-2 py-0.5 text-white"
                    : "text-ink-2",
                )}
              >
                {d.day}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {dayItems.length === 0 ? (
                <span className="text-[11px] text-ink-4">—</span>
              ) : (
                dayItems.map((item) => (
                  <ItemPill
                    key={`${item.kind}-${String(item.id)}`}
                    item={item}
                    hideCustomerLabel={hideCustomerLabel}
                    surface={surface}
                    expanded
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agenda list ────────────────────────────────────────────────────────

function AgendaList({
  items,
  hideCustomerLabel,
  surface,
}: {
  items: CalendarItem[];
  hideCustomerLabel?: boolean;
  surface: CalendarSurface;
}) {
  const groups = useMemo(() => groupByDateLabel(items), [items]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 py-16 text-sm text-ink-3">
        Nothing scheduled in this range.
      </div>
    );
  }

  return (
    <div className="px-8 py-2">
      {groups.map((g) => (
        <article
          key={g.dateKey}
          className={cn(
            "grid grid-cols-[80px_minmax(0,1fr)] gap-x-6 py-5 first:pt-6 last:pb-10",
            g.isPast && "opacity-55",
          )}
        >
          <DateAnchor group={g} />
          <ul className="-my-1 flex flex-col">
            {g.items.map((item) => (
              <AgendaRow
                key={`${item.kind}-${String(item.id)}`}
                item={item}
                hideCustomerLabel={hideCustomerLabel}
                surface={surface}
              />
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function DateAnchor({ group }: { group: AgendaGroup }) {
  const isToday = group.isToday;
  return (
    <div
      className={cn(
        "select-none border-l pl-4 leading-none",
        isToday ? "border-l-2 border-fmu-navy" : "border-line/60",
      )}
    >
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.18em]",
          isToday ? "text-fmu-navy" : "text-ink-3",
        )}
      >
        {isToday ? "Today" : group.isTomorrow ? "Tomorrow" : group.weekdayLabel}
      </div>
      <div
        className={cn(
          "num mt-2 text-[32px] font-light tabular-nums",
          isToday ? "text-fmu-navy" : "text-ink",
        )}
      >
        {group.dayLabel}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-4">
        {group.monthLabel}
      </div>
    </div>
  );
}

function AgendaRow({
  item,
  hideCustomerLabel,
  surface,
}: {
  item: CalendarItem;
  hideCustomerLabel?: boolean;
  surface: CalendarSurface;
}) {
  const isAllDayEvent = item.kind === "event" && item.allDay;
  const dotTone =
    item.kind === "task"
      ? "bg-fmu-navy"
      : item.category === "deadline"
        ? "bg-fmu-red"
        : item.category === "meeting"
          ? "bg-fmu-green"
          : item.category === "reminder" || item.category === "milestone"
            ? "bg-fmu-yellow"
            : "bg-ink-4";

  return (
    <li>
      <ItemLink
        item={item}
        surface={surface}
        className="group -mx-2 flex items-baseline gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-card-tint"
      >
        <span
          aria-hidden
          className={cn(
            "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
            dotTone,
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-snug text-ink group-hover:text-fmu-navy">
          {item.title}
        </span>
        {!hideCustomerLabel && item.customerName && (
          <span className="hidden shrink-0 truncate text-[11px] text-ink-3 sm:inline">
            {item.customerName}
          </span>
        )}
        <span className="num shrink-0 text-[11px] tabular-nums text-ink-4">
          {isAllDayEvent ? "all day" : formatTime(item.start)}
        </span>
      </ItemLink>
    </li>
  );
}

// ── Pill / icon / link helpers ─────────────────────────────────────────

function ItemPill({
  item,
  hideCustomerLabel,
  expanded,
  surface,
}: {
  item: CalendarItem;
  hideCustomerLabel?: boolean;
  expanded?: boolean;
  surface: CalendarSurface;
}) {
  const color = pillTone(item);
  return (
    <ItemLink
      item={item}
      surface={surface}
      className={cn(
        "group flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] leading-tight",
        color.bg,
        color.text,
        "hover:brightness-95",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", color.dot)} />
      <span className="truncate font-medium">{item.title}</span>
      {expanded && !hideCustomerLabel && item.customerName && (
        <span className="ml-auto truncate text-[10px] opacity-70">
          {item.customerName}
        </span>
      )}
    </ItemLink>
  );
}

function ItemLink({
  item,
  className,
  children,
  surface,
}: {
  item: CalendarItem;
  className?: string;
  children?: React.ReactNode;
  surface: CalendarSurface;
}) {
  const href = itemHref(item, surface);
  if (!href) {
    return <span className={className}>{children ?? item.title}</span>;
  }
  return (
    <Link href={href} prefetch={false} className={className}>
      {children ?? item.title}
    </Link>
  );
}

function itemHref(item: CalendarItem, surface: CalendarSurface): string | null {
  if (item.kind === "task" && item.customerId) {
    return surface === "portal"
      ? `/portal/c/${item.customerId}/tasks/${item.id}`
      : `/customers/${item.customerId}/tasks/${item.id}`;
  }
  if (item.kind === "event" && item.customerId) {
    return surface === "portal"
      ? `/portal/c/${item.customerId}`
      : `/customers/${item.customerId}`;
  }
  return null;
}

function pillTone(item: CalendarItem): {
  bg: string;
  text: string;
  dot: string;
  icon: string;
} {
  if (item.kind === "task") {
    return {
      bg: "bg-fmu-navy/10",
      text: "text-fmu-navy",
      dot: "bg-fmu-navy",
      icon: "text-fmu-navy",
    };
  }
  switch (item.category) {
    case "deadline":
      return {
        bg: "bg-fmu-red/10",
        text: "text-fmu-red",
        dot: "bg-fmu-red",
        icon: "text-fmu-red",
      };
    case "meeting":
      return {
        bg: "bg-fmu-green/10",
        text: "text-fmu-green",
        dot: "bg-fmu-green",
        icon: "text-fmu-green",
      };
    case "reminder":
    case "milestone":
      return {
        bg: "bg-fmu-yellow/15",
        text: "text-ink-2",
        dot: "bg-fmu-yellow",
        icon: "text-ink-3",
      };
    default:
      return {
        bg: "bg-card-tint",
        text: "text-ink-2",
        dot: "bg-ink-3",
        icon: "text-ink-3",
      };
  }
}

// ── Date math ──────────────────────────────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type MonthCell = {
  dateKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

type WeekDay = MonthCell & { dayOfWeek: number };

function buildMonthCells(cursor: number): MonthCell[] {
  const d = new Date(cursor);
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  // Roll back to Monday of the first row
  const dayOfWeekMonFirst = (first.getDay() + 6) % 7; // Mon=0..Sun=6
  const start = new Date(year, month, 1 - dayOfWeekMonFirst);
  const todayKey = toDateKey(Date.now());
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      dateKey: toDateKey(cur.getTime()),
      day: cur.getDate(),
      inMonth: cur.getMonth() === month,
      isToday: toDateKey(cur.getTime()) === todayKey,
    });
  }
  return cells;
}

function buildWeekDays(cursor: number): WeekDay[] {
  const d = new Date(cursor);
  const dayOfWeekMonFirst = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeekMonFirst);
  const todayKey = toDateKey(Date.now());
  const out: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    out.push({
      dateKey: toDateKey(cur.getTime()),
      day: cur.getDate(),
      dayOfWeek: i,
      inMonth: cur.getMonth() === d.getMonth(),
      isToday: toDateKey(cur.getTime()) === todayKey,
    });
  }
  return out;
}

function groupByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const k = toDateKey(it.start);
    const arr = map.get(k) ?? [];
    arr.push(it);
    map.set(k, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.start - b.start);
  return map;
}

type AgendaGroup = {
  dateKey: string;
  isToday: boolean;
  isTomorrow: boolean;
  isPast: boolean;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  items: CalendarItem[];
};

function groupByDateLabel(items: CalendarItem[]): AgendaGroup[] {
  const map = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const k = toDateKey(it.start);
    const arr = map.get(k) ?? [];
    arr.push(it);
    map.set(k, arr);
  }
  const today = toDateKey(Date.now());
  const tomorrow = toDateKey(Date.now() + 24 * 60 * 60 * 1000);
  const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
  const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short" });
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, list]) => {
      const [y, m, d] = dateKey.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return {
        dateKey,
        isToday: dateKey === today,
        isTomorrow: dateKey === tomorrow,
        isPast: dateKey < today,
        weekdayLabel: weekdayFmt.format(date),
        dayLabel: String(d),
        monthLabel: monthFmt.format(date),
        items: list.sort((a, b) => a.start - b.start),
      };
    });
}

function toDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "numeric",
  }).format(new Date(ts));
}

function formatLabel(cursor: number, mode: CalendarMode): string {
  const d = new Date(cursor);
  if (mode === "month") {
    return new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
    }).format(d);
  }
  if (mode === "week") {
    const days = buildWeekDays(cursor);
    const firstD = new Date(`${days[0].dateKey}T00:00:00`);
    const lastD = new Date(`${days[6].dateKey}T00:00:00`);
    const sameMonth =
      firstD.getMonth() === lastD.getMonth() &&
      firstD.getFullYear() === lastD.getFullYear();
    const monthShort = (date: Date) =>
      new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date);
    const yr = lastD.getFullYear();
    if (sameMonth) {
      return `${firstD.getDate()} – ${lastD.getDate()} ${monthShort(lastD)} ${yr}`;
    }
    return `${firstD.getDate()} ${monthShort(firstD)} – ${lastD.getDate()} ${monthShort(lastD)} ${yr}`;
  }
  // agenda
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(d);
}

function stepCursor(cursor: number, mode: CalendarMode, delta: number): number {
  const d = new Date(cursor);
  if (mode === "week") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7).getTime();
  }
  if (mode === "month" || mode === "agenda") {
    return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
  }
  return cursor;
}

// ── Local persistence helper ───────────────────────────────────────────

const MODE_KEY = "cockpit.calendar.mode";

export function useCalendarMode(initial: CalendarMode = "month") {
  const [mode, setModeState] = useState<CalendarMode>(initial);
  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_KEY) as CalendarMode | null;
    if (saved === "month" || saved === "week" || saved === "agenda") {
      setModeState(saved);
    }
  }, []);
  const setMode = (m: CalendarMode) => {
    setModeState(m);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_KEY, m);
    }
  };
  return [mode, setMode] as const;
}
