"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { ListChecks, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatDue } from "@/lib/formatters";
import { cn } from "@/lib/utils";

type Row = {
  id: Id<"tasks">;
  title: string;
  type: string;
  status: string;
  dueDate: number | null;
  customerId: Id<"customers">;
  customerName: string | null;
  assignedTo: Id<"users"> | null;
  createdAt: number;
};

type Props =
  | {
      scope: "customer";
      customerId: Id<"customers">;
      onNewTask?: () => void;
    }
  | {
      scope: "workspace";
      onNewTask?: () => void;
    };

export function TaskPanel(props: Props) {
  const customerRows = useQuery(
    api.tasks.listOpenByCustomer,
    props.scope === "customer" ? { customerId: props.customerId } : "skip",
  );
  const workspaceRows = useQuery(
    api.tasks.listOpenForWorkspace,
    props.scope === "workspace" ? {} : "skip",
  );
  const rows = props.scope === "customer" ? customerRows : workspaceRows;
  const showCustomer = props.scope === "workspace";

  const groups = useMemo(() => groupRows(rows ?? []), [rows]);
  const total = rows?.length ?? 0;

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-card">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink">Open tasks</h2>
          {rows !== undefined && (
            <span className="text-xs text-ink-4">{total}</span>
          )}
        </div>
        {props.onNewTask && (
          <Button size="sm" variant="outline" onClick={props.onNewTask}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows === undefined && (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        )}
        {rows !== undefined && total === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <ListChecks className="h-5 w-5 text-ink-4" />
            <p className="text-sm text-ink-3">No open tasks.</p>
          </div>
        )}
        {rows !== undefined && total > 0 && (
          <div className="flex flex-col">
            {groups.map((g) => (
              <Group key={g.key} group={g} showCustomer={showCustomer} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Grouping ───────────────────────────────────────────────────────────

type GroupKey = "overdue" | "today" | "this-week" | "later" | "undated";

type Group = {
  key: GroupKey;
  label: string;
  rows: Row[];
};

function groupRows(rows: Row[]): Group[] {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const weekEnd = startOfDay(now + 7 * 24 * 60 * 60 * 1000);

  const overdue: Row[] = [];
  const today: Row[] = [];
  const week: Row[] = [];
  const later: Row[] = [];
  const undated: Row[] = [];

  for (const r of rows) {
    if (r.dueDate === null) {
      undated.push(r);
    } else if (r.dueDate < todayStart) {
      overdue.push(r);
    } else if (r.dueDate < tomorrowStart) {
      today.push(r);
    } else if (r.dueDate < weekEnd) {
      week.push(r);
    } else {
      later.push(r);
    }
  }

  const groups: Group[] = [];
  if (overdue.length) groups.push({ key: "overdue", label: "Overdue", rows: overdue });
  if (today.length) groups.push({ key: "today", label: "Today", rows: today });
  if (week.length) groups.push({ key: "this-week", label: "This week", rows: week });
  if (later.length) groups.push({ key: "later", label: "Later", rows: later });
  if (undated.length) groups.push({ key: "undated", label: "No deadline", rows: undated });
  return groups;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Render ─────────────────────────────────────────────────────────────

function Group({ group, showCustomer }: { group: Group; showCustomer: boolean }) {
  const tone = group.key === "overdue" ? "text-fmu-red" : "text-ink-3";
  return (
    <section>
      <div
        className={cn(
          "sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b border-line bg-card-tint/95 px-4 py-1.5 backdrop-blur",
        )}
      >
        <h3 className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", tone)}>
          {group.label}
        </h3>
        <span className="text-[11px] text-ink-4">{group.rows.length}</span>
      </div>
      <ul className="divide-y divide-line/60">
        {group.rows.map((r) => (
          <li key={r.id}>
            <TaskRow row={r} showCustomer={showCustomer} overdue={group.key === "overdue"} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskRow({
  row,
  showCustomer,
  overdue,
}: {
  row: Row;
  showCustomer: boolean;
  overdue: boolean;
}) {
  return (
    <Link
      href={`/customers/${row.customerId}/tasks/${row.id}`}
      prefetch={false}
      className="block px-4 py-2.5 transition-colors hover:bg-card-tint"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {row.title}
        </span>
        {row.dueDate !== null && (
          <span
            className={cn(
              "num shrink-0 text-[11px] tabular-nums",
              overdue ? "text-fmu-red" : "text-ink-3",
            )}
          >
            {formatDue(row.dueDate)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
        {showCustomer && row.customerName && (
          <span className="truncate">{row.customerName}</span>
        )}
        {showCustomer && row.customerName && <span className="text-ink-4">·</span>}
        <span className="truncate">{prettyTaskType(row.type)}</span>
        <span className="text-ink-4">·</span>
        <span className={cn("pill", `pill--${row.status}`)}>{row.status}</span>
      </div>
    </Link>
  );
}

function prettyTaskType(type: string): string {
  // "core.todo" → "Todo"; "accounting.bank_rec" → "Bank rec"
  const last = type.split(".").pop() ?? type;
  return last
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

