"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatComposer } from "@/components/chat/chat-composer";
import { LoadingState } from "@/components/states";

/**
 * Compact conversation panel for the customer home page — the shared
 * (client-facing) thread, full history. Scroll up to read back; the composer
 * is pinned to the bottom. Mirrors the firm side of the dedicated chat page.
 */
export function CustomerChatPanel({
  customerId,
}: {
  customerId: Id<"customers">;
}) {
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

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-card">
      <header className="border-b border-line px-4 py-3">
        <div className="eyebrow">Conversation</div>
        <p className="text-[12px] text-ink-3">Shared with the customer.</p>
      </header>
      {threadId ? (
        <PanelBody threadId={threadId} customerId={customerId} />
      ) : (
        <LoadingState className="flex flex-1 items-center justify-center" />
      )}
    </aside>
  );
}

function PanelBody({
  threadId,
  customerId,
}: {
  threadId: Id<"threads">;
  customerId: Id<"customers">;
}) {
  const router = useRouter();
  const messages = useQuery(api.messages.listByThread, { threadId });
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages?.length]);

  return (
    <>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages === undefined && <LoadingState />}
        {messages !== undefined && messages.length === 0 && (
          <div className="text-sm text-ink-3">
            No messages yet. Start the conversation.
          </div>
        )}
        {messages !== undefined && messages.length > 0 && (
          <ChatMessageList
            messages={messages}
            customerId={customerId}
            surface="firm"
            onSelectTask={(taskId) =>
              router.push(`/customers/${customerId}/tasks/${taskId}`)
            }
          />
        )}
      </div>
      <ChatComposer threadId={threadId} customerId={customerId} compact />
    </>
  );
}
