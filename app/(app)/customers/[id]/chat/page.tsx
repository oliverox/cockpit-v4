"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Send } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";

export default function CustomerChatPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;

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

  if (!threadId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  return <ChatSurface threadId={threadId} />;
}

function ChatSurface({ threadId }: { threadId: Id<"threads"> }) {
  const messages = useQuery(api.messages.listByThread, { threadId });
  const send = useMutation(api.messages.send);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages.
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages?.length]);

  async function onSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await send({ threadId, text });
      setDraft("");
      composerRef.current?.focus();
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-card px-8 py-3">
        <div className="eyebrow">Internal</div>
        <div className="text-sm text-ink-3">
          Visible to firm members only.
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-8 py-6"
      >
        {messages === undefined && (
          <div className="text-sm text-ink-3">Loading…</div>
        )}
        {messages !== undefined && messages.length === 0 && (
          <div className="text-sm text-ink-3">
            No messages yet. Start the conversation below.
          </div>
        )}
        {messages !== undefined && messages.length > 0 && (
          <MessageList messages={messages} />
        )}
      </div>

      <div className="border-t border-line bg-card px-8 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Write a message… (Shift+Enter for new line)"
            rows={2}
            disabled={sending}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-line bg-card px-3 py-2 text-sm outline-none focus:border-fmu-navy"
          />
          <Button
            type="button"
            onClick={() => void onSend()}
            disabled={!draft.trim() || sending}
            size="lg"
          >
            <Send className="h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

type EnrichedMessage = {
  _id: Id<"messages">;
  _creationTime: number;
  authorId: Id<"users">;
  text?: string;
  sender: {
    displayName: string;
    avatarUrl: string | null;
    kind: "human" | "ai";
  } | null;
};

function MessageList({ messages }: { messages: EnrichedMessage[] }) {
  // Group consecutive messages from the same sender; render a tighter stack.
  type Group = {
    authorId: Id<"users">;
    sender: EnrichedMessage["sender"];
    messages: EnrichedMessage[];
    firstAt: number;
  };
  const groups: Group[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.authorId === m.authorId &&
      // group within 5 minutes
      m._creationTime - last.messages[last.messages.length - 1]._creationTime <
        5 * 60_000
    ) {
      last.messages.push(m);
    } else {
      groups.push({
        authorId: m.authorId,
        sender: m.sender,
        messages: [m],
        firstAt: m._creationTime,
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {groups.map((g) => (
        <div
          key={g.messages[0]._id}
          className="flex items-start gap-3"
        >
          <InitialsAvatar
            name={g.sender?.displayName ?? "?"}
            size="md"
            className={cn(
              g.sender?.kind === "ai" && "bg-fmu-yellow text-fmu-navy",
            )}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">
                {g.sender?.displayName ?? "Unknown"}
              </span>
              <span className="num text-xs text-ink-4">
                {formatTime(g.firstAt)}
              </span>
            </div>
            <div className="space-y-1">
              {g.messages.map((m) => (
                <div
                  key={m._id}
                  className="whitespace-pre-wrap text-sm text-ink-2 leading-relaxed"
                >
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "numeric",
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "numeric",
  }).format(d);
}
