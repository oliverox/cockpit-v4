"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Hash, Send } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { TaskChip } from "@/components/chat/task-chip";
import { cn } from "@/lib/utils";

type Props = {
  threadId: Id<"threads">;
  customerId: Id<"customers">;
  /** Pre-tag every outgoing message with this task. Used on task pages. */
  pinnedTaskId?: Id<"tasks">;
  /** Tighter padding for narrow side-panel embeds. */
  compact?: boolean;
};

type Picked = { id: Id<"tasks">; title: string; status: string };

export function ChatComposer({
  threadId,
  customerId,
  pinnedTaskId,
  compact,
}: Props) {
  const send = useMutation(api.messages.send);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [draft, setDraft] = useState("");
  const [refs, setRefs] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);

  // Autocomplete state ────────────────────────────────────────────────
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  /** Position in `draft` where the active `#` lives, or null if not mentioning. */
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function updateMentionStateFromText(text: string, cursor: number) {
    // Walk back from cursor to find a `#` that starts a mention.
    let i = cursor - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "#") {
        const prev = i === 0 ? " " : text[i - 1];
        if (/[\s]/.test(prev) || i === 0) {
          // Inside a mention. Query is the substring from i+1 to cursor.
          const slice = text.slice(i + 1, cursor);
          // If a whitespace ever appears in the slice, mention is over.
          if (/\s/.test(slice)) break;
          setMentionStart(i);
          setMentionQuery(slice);
          setPopoverOpen(true);
          return;
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i--;
    }
    setMentionStart(null);
    setMentionQuery("");
    setPopoverOpen(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setDraft(text);
    const cursor = e.target.selectionStart ?? text.length;
    updateMentionStateFromText(text, cursor);
  }

  // Task list for popover ──────────────────────────────────────────────
  const allTasks = useQuery(
    api.tasks.listByCustomer,
    popoverOpen ? { customerId } : "skip",
  );

  const excludeIds = useMemo(
    () => new Set([...refs.map((r) => r.id), ...(pinnedTaskId ? [pinnedTaskId] : [])]),
    [refs, pinnedTaskId],
  );

  const options = useMemo<Picked[]>(() => {
    if (!allTasks) return [];
    const q = mentionQuery.trim().toLowerCase();
    const active = allTasks.filter(
      (t) => t.status !== "cancelled" && !excludeIds.has(t._id),
    );
    const matched = q
      ? active.filter((t) => t.title.toLowerCase().includes(q))
      : active;
    return matched.slice(0, 8).map((t) => ({
      id: t._id,
      title: t.title,
      status: t.status,
    }));
  }, [allTasks, mentionQuery, excludeIds]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mentionQuery, popoverOpen]);

  function pick(option: Picked) {
    if (mentionStart === null) {
      // Pick via mouse without mention context — just add the chip.
      setRefs((r) => [...r, option]);
      setPopoverOpen(false);
      textareaRef.current?.focus();
      return;
    }
    // Replace `#<query>` in the text with empty (we only want the chip,
    // tracked separately) and append/track the ref.
    const text = draft;
    const before = text.slice(0, mentionStart);
    const after = text.slice(mentionStart + 1 + mentionQuery.length);
    const next = before + after;
    setDraft(next);
    setRefs((r) => (r.some((x) => x.id === option.id) ? r : [...r, option]));
    setMentionStart(null);
    setMentionQuery("");
    setPopoverOpen(false);
    // Restore cursor near where the `#` was.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popoverOpen && options.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopoverOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  }

  async function onSend() {
    const text = draft.trim();
    if (!text && refs.length === 0) return;
    if (sending) return;
    setSending(true);
    try {
      const ids = Array.from(
        new Set([
          ...(pinnedTaskId ? [pinnedTaskId] : []),
          ...refs.map((r) => r.id),
        ]),
      );
      await send({
        threadId,
        text: text || "(no message)",
        taskRefs: ids.length > 0 ? ids : undefined,
      });
      setDraft("");
      setRefs([]);
      setPopoverOpen(false);
      textareaRef.current?.focus();
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  const disabled = sending || (draft.trim().length === 0 && refs.length === 0);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            "border-t border-line bg-card py-3",
            compact ? "px-3" : "px-8",
          )}
        >
          {refs.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {refs.map((r) => (
                <TaskChip
                  key={r.id}
                  taskId={r.id}
                  customerId={customerId}
                  title={r.title}
                  onRemove={() =>
                    setRefs((current) => current.filter((x) => x.id !== r.id))
                  }
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Write a message…  type # to reference a task"
              rows={2}
              disabled={sending}
              className="min-h-[44px] flex-1 resize-none rounded-md border border-line bg-card px-3 py-2 text-sm outline-none focus:border-fmu-navy"
            />
            <Button
              type="button"
              onClick={() => void onSend()}
              disabled={disabled}
              size="lg"
            >
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-80 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
          Reference a task
        </div>
        {options.length === 0 ? (
          <div className="px-2 py-3 text-sm text-ink-3">
            {allTasks === undefined ? "Loading…" : "No matching tasks."}
          </div>
        ) : (
          <ul className="max-h-72 overflow-auto py-0.5">
            {options.map((opt, i) => (
              <li key={opt.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(opt);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    i === activeIndex
                      ? "bg-fmu-navy/10 text-fmu-navy"
                      : "text-ink hover:bg-card-tint",
                  )}
                >
                  <Hash className="h-3.5 w-3.5 shrink-0 text-fmu-navy/70" />
                  <span className="min-w-0 flex-1 truncate">{opt.title}</span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-4">
                    {opt.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
