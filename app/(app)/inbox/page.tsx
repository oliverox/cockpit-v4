"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Inbox as InboxIcon, ListChecks, Eye } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { statusDisplay, typeDisplay } from "@/lib/task-display";
import { cn } from "@/lib/utils";

export default function InboxPage() {
  const items = useQuery(api.inbox.listForCurrentUser);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Inbox</h1>

      {items === undefined && (
        <p className="text-sm text-ink-3">Loading…</p>
      )}
      {items !== undefined && items.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-line bg-card-tint p-6">
          <InboxIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" />
          <div>
            <p className="text-sm font-medium text-ink">All caught up</p>
            <p className="mt-0.5 text-sm text-ink-3">
              Nothing assigned to you right now.
            </p>
          </div>
        </div>
      )}

      {items !== undefined && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <InboxRow key={`${item.kind}-${String(item.id)}`} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Item = NonNullable<
  ReturnType<typeof useQuery<typeof api.inbox.listForCurrentUser>>
>[number];

function InboxRow({ item }: { item: Item }) {
  const { label, pill } = statusDisplay(item.status, item.type);
  const Icon = item.kind === "review_pending" ? Eye : ListChecks;
  const overdue = item.dueDate !== null && item.dueDate < Date.now();

  return (
    <li>
      <Link
        href={`/customers/${item.customerId}/tasks/${item.id}`}
        prefetch={false}
        className="flex items-center gap-3 px-4 py-3 hover:bg-card-tint"
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            item.kind === "review_pending" ? "text-ink-3" : "text-fmu-navy",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">
            {item.title}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
            {item.customerName && (
              <span className="truncate">{item.customerName}</span>
            )}
            <span className="text-ink-4">·</span>
            <span>{typeDisplay(item.type)}</span>
            {item.kind === "review_pending" && (
              <>
                <span className="text-ink-4">·</span>
                <span>Awaiting review</span>
              </>
            )}
          </div>
        </div>
        {item.dueDate !== null && (
          <span
            className={cn(
              "num text-xs",
              overdue ? "font-semibold text-fmu-red" : "text-ink-3",
            )}
          >
            {formatDueDate(item.dueDate)}
          </span>
        )}
        <span className={`pill pill--${pill}`}>{label}</span>
      </Link>
    </li>
  );
}

function formatDueDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = ts - now.getTime();
  const day = 24 * 60 * 60 * 1000;

  if (diff < -day) {
    const daysAgo = Math.floor(-diff / day);
    return `${daysAgo}d overdue`;
  }
  if (diff < 0) return "Today";
  if (diff < day) return "Today";
  if (diff < 2 * day) return "Tomorrow";
  if (diff < 7 * day) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d);
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(d);
}
