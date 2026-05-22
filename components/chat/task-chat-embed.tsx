"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { ChatComposer } from "@/components/chat/chat-composer";
import { TaskChip } from "@/components/chat/task-chip";
import { MessageCard } from "@/components/chat/message-card";
import { cn } from "@/lib/utils";

type Props = {
  customerId: Id<"customers">;
  taskId: Id<"tasks">;
};

/**
 * Discussion panel for a single task. Reads from the customer's firm-internal
 * thread and filters to messages whose `taskRefs` include this task. Replies
 * via the embedded composer auto-tag the current task.
 */
export function TaskChatEmbed({ customerId, taskId }: Props) {
  const ensureThread = useMutation(api.threads.ensureCustomerInternalThread);
  const [threadId, setThreadId] = useState<Id<"threads"> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ensureThread({ customerId }).then((id) => {
      if (!cancelled) setThreadId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, ensureThread]);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-card">
      <header className="border-b border-line px-4 py-3">
        <div className="eyebrow">Discussion</div>
        <p className="text-[12px] text-ink-3">
          Replies are tagged to this task.
        </p>
      </header>
      {threadId ? (
        <Body threadId={threadId} taskId={taskId} customerId={customerId} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-3">
          Loading…
        </div>
      )}
    </aside>
  );
}

function Body({
  threadId,
  taskId,
  customerId,
}: {
  threadId: Id<"threads">;
  taskId: Id<"tasks">;
  customerId: Id<"customers">;
}) {
  const messages = useQuery(api.messages.listByThread, { threadId });
  const scrollerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!messages) return undefined;
    return messages.filter((m) =>
      (m.taskRefs ?? []).some((id) => id === taskId),
    );
  }, [messages, taskId]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [filtered?.length]);

  return (
    <>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {filtered === undefined && (
          <div className="text-sm text-ink-3">Loading…</div>
        )}
        {filtered !== undefined && filtered.length === 0 && (
          <div className="text-sm text-ink-3">
            No discussion yet. Replies you send here will be tagged to this task.
          </div>
        )}
        {filtered !== undefined && filtered.length > 0 && (
          <CompactMessageList messages={filtered} customerId={customerId} />
        )}
      </div>
      <CompactComposer
        threadId={threadId}
        customerId={customerId}
        pinnedTaskId={taskId}
      />
    </>
  );
}

type EnrichedMessage = {
  _id: Id<"messages">;
  _creationTime: number;
  authorId: Id<"users">;
  kind: "text" | "card" | "system";
  text?: string;
  cardType?: string;
  cardPayload?: unknown;
  taskRefs?: Id<"tasks">[];
  taskRefDetails: {
    id: Id<"tasks">;
    title: string;
    status: string;
    customerId: Id<"customers">;
  }[];
  sender: {
    displayName: string;
    avatarUrl: string | null;
    kind: "human" | "ai";
  } | null;
};

function CompactMessageList({
  messages,
  customerId,
}: {
  messages: EnrichedMessage[];
  customerId: Id<"customers">;
}) {
  return (
    <ul className="space-y-4">
      {messages.map((m) => (
        <li key={m._id} className="flex items-start gap-2">
          <InitialsAvatar
            name={m.sender?.displayName ?? "?"}
            size="sm"
            className={cn(
              m.sender?.kind === "ai" && "bg-fmu-yellow text-fmu-navy",
            )}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-ink">
                {m.sender?.displayName ?? "Unknown"}
              </span>
              <span className="num text-[11px] text-ink-4">
                {formatRelTime(m._creationTime)}
              </span>
            </div>
            {m.kind === "card" && m.cardType ? (
              <MessageCard
                cardType={m.cardType}
                cardPayload={m.cardPayload}
                customerId={customerId}
              />
            ) : (
              m.text && (
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
                  {m.text}
                </div>
              )
            )}
            {m.kind !== "card" && m.taskRefDetails.length > 1 && (
              // Show only OTHER tasks (the pinned one is implied here).
              <div className="flex flex-wrap gap-1">
                {m.taskRefDetails
                  .filter((t) => t.customerId === customerId)
                  .map((t) => (
                    <TaskChip
                      key={t.id}
                      taskId={t.id}
                      customerId={customerId}
                      title={t.title}
                    />
                  ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Thin wrapper that swaps the chat composer's outer padding for the embed's
 * tighter rhythm. The composer itself owns the textarea, popover, and chips.
 */
function CompactComposer(props: {
  threadId: Id<"threads">;
  customerId: Id<"customers">;
  pinnedTaskId: Id<"tasks">;
}) {
  return <ChatComposer {...props} compact />;
}

function formatRelTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = new Date(ts);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(d);
}
