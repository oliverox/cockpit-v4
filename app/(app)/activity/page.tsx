"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { InitialsAvatar } from "@/components/layout/user-menu";

/**
 * Cross-customer client conversations.
 *
 * Lists every customer whose shared thread has activity, most recent first,
 * with a one-line preview of the latest message. Click → jump into that
 * customer's chat with the audience already set to "Shared with client".
 */
export default function ActivityPage() {
  const rows = useQuery(api.messages.listRecentSharedAcrossWorkspace, {});

  return (
    <div className="w-full px-8 py-8">
      <header className="mb-6">
        <div className="eyebrow">Workspace</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          Client conversations
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Recent activity across the shared threads with your clients.
        </p>
      </header>

      {rows === undefined && (
        <div className="text-sm text-ink-3">Loading…</div>
      )}
      {rows !== undefined && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-6 py-10 text-center">
          <MessageCircle className="mx-auto mb-3 h-6 w-6 text-ink-4" />
          <p className="text-sm text-ink-3">
            No client conversations yet. They'll appear here once you or a
            client posts in a shared thread.
          </p>
        </div>
      )}
      {rows !== undefined && rows.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {rows.map((r) => (
            <li key={r.threadId}>
              <ActivityRow row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Row = NonNullable<
  ReturnType<typeof useQuery<typeof api.messages.listRecentSharedAcrossWorkspace>>
>[number];

function ActivityRow({ row }: { row: Row }) {
  if (!row.customerId) return null;
  return (
    <Link
      href={`/customers/${row.customerId}/chat`}
      prefetch={false}
      className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-card-tint"
    >
      <InitialsAvatar name={row.last?.senderName ?? "?"} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-ink group-hover:text-fmu-green">
            {row.customerName ?? "Customer"}
          </span>
          {row.last?.senderName && (
            <span className="truncate text-[11px] text-ink-3">
              · {row.last.senderName}
            </span>
          )}
          <span className="num ml-auto shrink-0 text-[11px] text-ink-4">
            {formatTime(row.lastMessageAt)}
          </span>
        </div>
        <div className="mt-1 truncate text-[13px] text-ink-2">
          {renderPreview(row.last)}
        </div>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-4 transition-colors group-hover:text-fmu-green" />
    </Link>
  );
}

function renderPreview(last: Row["last"]): string {
  if (!last) return "";
  if (last.kind === "card") {
    if (last.cardType === "task.created") return "↳ New task created";
    if (last.cardType === "document.uploaded") return "↳ Document attached";
    return `↳ ${last.cardType ?? "Update"}`;
  }
  return last.text ?? "";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(d);
}

