"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { EmptyState, LoadingState } from "@/components/states";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

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
    <PageShell>
      <PageHeader
        eyebrow="Workspace"
        title="Client conversations"
        description="Recent activity across the shared threads with your clients."
      />

      {rows === undefined && <LoadingState />}
      {rows !== undefined && rows.length === 0 && (
        <EmptyState icon={MessageCircle}>
          No client conversations yet. They'll appear here once you or a
          client posts in a shared thread.
        </EmptyState>
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
    </PageShell>
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

