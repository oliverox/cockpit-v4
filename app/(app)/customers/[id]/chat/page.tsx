"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import {
  ChatContextPanel,
  type ChatSelection,
} from "@/components/chat/chat-context-panel";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/states";

export default function CustomerChatPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;

  const ensureThread = useMutation(api.threads.ensureCustomerSharedThread);
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

  if (!threadId) {
    return <LoadingState centered />;
  }

  return <ChatSurface threadId={threadId} customerId={customerId} />;
}

function ChatSurface({
  threadId,
  customerId,
}: {
  threadId: Id<"threads">;
  customerId: Id<"customers">;
}) {
  const messages = useQuery(api.messages.listByThread, { threadId });
  const scrollerRef = useRef<HTMLDivElement>(null);

  const [taskFilter, setTaskFilter] = useState<Id<"tasks"> | null>(null);
  const [selection, setSelection] = useState<ChatSelection>(null);

  const filtered = useMemo(() => {
    if (messages === undefined) return undefined;
    if (taskFilter === null) return messages;
    return messages.filter((m) =>
      (m.taskRefs ?? []).some((id) => id === taskFilter),
    );
  }, [messages, taskFilter]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [filtered?.length]);

  return (
    <div className="grid h-full gap-0 lg:grid-cols-2">
      <div className="flex h-full min-h-0 flex-col border-r border-line">
        <ChatHeader
          customerId={customerId}
          taskFilter={taskFilter}
          onClearFilter={() => setTaskFilter(null)}
          onSetFilter={setTaskFilter}
        />

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-8 py-6">
          {filtered === undefined && <LoadingState />}
          {filtered !== undefined && filtered.length === 0 && (
            <div className="text-sm text-ink-3">
              {taskFilter
                ? "No messages reference this task yet."
                : "No messages yet. Start the conversation."}
            </div>
          )}
          {filtered !== undefined && filtered.length > 0 && (
            <ChatMessageList
              messages={filtered}
              customerId={customerId}
              surface="firm"
              onSelectTask={(taskId) => setSelection({ kind: "task", taskId })}
              onSelectDocument={(documentId, taskId) =>
                setSelection({ kind: "document", documentId, taskId })
              }
            />
          )}
        </div>

        <ChatComposer threadId={threadId} customerId={customerId} />
      </div>
      <div className="hidden h-full min-h-0 p-3 lg:block">
        <ChatContextPanel
          selection={selection}
          customerId={customerId}
          surface="firm"
          onClear={() => setSelection(null)}
        />
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────

function ChatHeader({
  customerId,
  taskFilter,
  onClearFilter,
  onSetFilter,
}: {
  customerId: Id<"customers">;
  taskFilter: Id<"tasks"> | null;
  onClearFilter: () => void;
  onSetFilter: (id: Id<"tasks">) => void;
}) {
  const tasks = useQuery(api.tasks.listByCustomer, { customerId });
  const filterLabel = useMemo(() => {
    if (!taskFilter || !tasks) return null;
    return tasks.find((t) => t._id === taskFilter)?.title ?? "Task";
  }, [taskFilter, tasks]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-8 py-3">
      <div>
        <div className="eyebrow">Conversation</div>
        <div className="text-sm text-ink-3">
          Shared with the customer.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink-2 hover:border-line-2 hover:bg-card-tint",
                taskFilter && "border-fmu-navy/40 text-fmu-navy",
              )}
            >
              {taskFilter ? (
                <>
                  <span className="max-w-[14ch] truncate">
                    #{filterLabel ?? "Task"}
                  </span>
                </>
              ) : (
                <>All tasks</>
              )}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onSelect={onClearFilter}>
              All messages
            </DropdownMenuItem>
            {tasks?.map((t) => (
              <DropdownMenuItem key={t._id} onSelect={() => onSetFilter(t._id)}>
                <span className="max-w-full truncate">#{t.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {taskFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4 hover:bg-card-tint hover:text-ink"
            aria-label="Clear filter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

