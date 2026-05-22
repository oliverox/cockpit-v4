"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { TaskChip } from "@/components/chat/task-chip";
import { MessageCard, type CardSurface } from "@/components/chat/message-card";
import { cn } from "@/lib/utils";

export type EnrichedMessage = {
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

type Props = {
  messages: EnrichedMessage[];
  customerId: Id<"customers">;
  surface: CardSurface;
  /** When set, clicks on tasks (chips, cards) open in the right pane instead of navigating. */
  onSelectTask?: (taskId: Id<"tasks">) => void;
  /** When set, clicks on documents in cards open in the right pane instead of downloading. */
  onSelectDocument?: (
    documentId: Id<"documents">,
    taskId: Id<"tasks">,
  ) => void;
};

/**
 * Shared chat list — WhatsApp-style alternating bubbles.
 *
 *   • Messages from the current user → right-aligned green bubbles, no avatar.
 *   • Messages from anyone else      → left-aligned white bubbles, avatar +
 *                                       sender name shown once per group.
 *   • Consecutive messages from the same author within 5 minutes are stacked
 *     as a single group with shared header.
 *   • System cards (task.created, document.uploaded) render as the standalone
 *     `MessageCard` instead of a bubble, aligned to the author side.
 */
export function ChatMessageList({
  messages,
  customerId,
  surface,
  onSelectTask,
  onSelectDocument,
}: Props) {
  const me = useQuery(api.users.getCurrentUser, {});
  const myUserId = me?._id ?? null;

  type Group = {
    authorId: Id<"users">;
    sender: EnrichedMessage["sender"];
    isSelf: boolean;
    messages: EnrichedMessage[];
    firstAt: number;
  };
  const groups: Group[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.authorId === m.authorId &&
      m._creationTime -
        last.messages[last.messages.length - 1]._creationTime <
        5 * 60_000
    ) {
      last.messages.push(m);
    } else {
      groups.push({
        authorId: m.authorId,
        sender: m.sender,
        isSelf: myUserId !== null && m.authorId === myUserId,
        messages: [m],
        firstAt: m._creationTime,
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {groups.map((g) => (
        <MessageGroup
          key={g.messages[0]._id}
          group={g}
          customerId={customerId}
          surface={surface}
          onSelectTask={onSelectTask}
          onSelectDocument={onSelectDocument}
        />
      ))}
    </div>
  );
}

function MessageGroup({
  group,
  customerId,
  surface,
  onSelectTask,
  onSelectDocument,
}: {
  group: {
    authorId: Id<"users">;
    sender: EnrichedMessage["sender"];
    isSelf: boolean;
    messages: EnrichedMessage[];
    firstAt: number;
  };
  customerId: Id<"customers">;
  surface: CardSurface;
  onSelectTask?: (taskId: Id<"tasks">) => void;
  onSelectDocument?: (
    documentId: Id<"documents">,
    taskId: Id<"tasks">,
  ) => void;
}) {
  const { isSelf, sender } = group;

  return (
    <div className={cn("flex w-full gap-2", isSelf && "flex-row-reverse")}>
      {!isSelf && (
        <div className="mt-5 shrink-0">
          <InitialsAvatar
            name={sender?.displayName ?? "?"}
            size="sm"
            className={cn(
              sender?.kind === "ai" && "bg-fmu-yellow text-fmu-navy",
            )}
          />
        </div>
      )}
      <div
        className={cn(
          "flex min-w-0 max-w-[600px] flex-col gap-1",
          isSelf ? "items-end" : "items-start",
        )}
      >
        {!isSelf && (
          <div className="flex items-baseline gap-2 px-1">
            <span className="text-[12px] font-semibold text-ink">
              {sender?.displayName ?? "Unknown"}
            </span>
            <span className="num text-[10px] text-ink-4">
              {formatTime(group.firstAt)}
            </span>
          </div>
        )}
        {group.messages.map((m, i) =>
          m.kind === "card" && m.cardType ? (
            <div
              key={m._id}
              className={cn(
                "w-full max-w-[420px]",
                isSelf ? "items-end" : "items-start",
              )}
            >
              <MessageCard
                cardType={m.cardType}
                cardPayload={m.cardPayload}
                customerId={customerId}
                surface={surface}
                onSelectTask={onSelectTask}
                onSelectDocument={onSelectDocument}
              />
              {isSelf && i === group.messages.length - 1 && (
                <div className="mt-1 px-1 text-right">
                  <span className="num text-[10px] text-ink-4">
                    {formatTime(m._creationTime)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <Bubble
              key={m._id}
              isSelf={isSelf}
              isFirstInGroup={i === 0}
              isLastInGroup={i === group.messages.length - 1}
              text={m.text}
              taskRefDetails={m.taskRefDetails}
              customerId={customerId}
              surface={surface}
              creationTime={m._creationTime}
              onSelectTask={onSelectTask}
            />
          ),
        )}
      </div>
    </div>
  );
}

function Bubble({
  isSelf,
  isFirstInGroup,
  isLastInGroup,
  text,
  taskRefDetails,
  customerId,
  surface,
  creationTime,
  onSelectTask,
}: {
  isSelf: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  text?: string;
  taskRefDetails: EnrichedMessage["taskRefDetails"];
  customerId: Id<"customers">;
  surface: CardSurface;
  creationTime: number;
  onSelectTask?: (taskId: Id<"tasks">) => void;
}) {
  return (
    <div
      className={cn(
        "max-w-full rounded-2xl px-3.5 py-2",
        isSelf
          ? "bg-fmu-green/15 text-ink"
          : "border border-line bg-card text-ink-2",
        // WhatsApp "tail" — flattened corner on the first bubble of a group
        isFirstInGroup && (isSelf ? "rounded-tr-md" : "rounded-tl-md"),
      )}
    >
      {text && (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {text}
        </div>
      )}
      {taskRefDetails.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {taskRefDetails.map((t) => (
            <TaskChip
              key={t.id}
              taskId={t.id}
              customerId={customerId}
              title={t.title}
              surface={surface}
              onSelect={onSelectTask ? () => onSelectTask(t.id) : undefined}
            />
          ))}
        </div>
      )}
      {isLastInGroup && (
        <div
          className={cn(
            "mt-1 text-[10px] leading-none",
            isSelf ? "text-fmu-green/80" : "text-ink-4",
            isSelf ? "text-right" : "text-left",
          )}
        >
          <span className="num">{formatTime(creationTime)}</span>
        </div>
      )}
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
