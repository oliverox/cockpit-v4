"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  document: Doc<"documents">;
  customerId: Id<"customers">;
};

/**
 * Tag editor for a document.
 *
 *  • Renders the current tags as small pills (with × on hover to remove).
 *  • A subtle "+" trigger opens a popover with an input and a suggestion
 *    list pulled from `documents.listTagsByCustomer`.
 *  • Type + Enter to add, or click a suggestion. Backspace on empty
 *    input removes the last tag.
 *  • Mutations call `documents.setTags` to replace the whole tag list.
 */
export function TagEditor({ document, customerId }: Props) {
  const setTags = useMutation(api.documents.setTags);
  const existingTags = useQuery(api.documents.listTagsByCustomer, {
    customerId,
  });

  async function removeTag(tag: string) {
    await setTags({
      documentId: document._id,
      tags: document.tags.filter((t) => t !== tag),
    });
  }

  async function addTag(raw: string) {
    const next = raw.trim().toLowerCase();
    if (!next) return;
    if (document.tags.includes(next)) return;
    await setTags({
      documentId: document._id,
      tags: [...document.tags, next],
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {document.tags.map((tag) => (
        <TagPill
          key={tag}
          tag={tag}
          onRemove={() => void removeTag(tag)}
          disabled={document.archived === true}
        />
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={document.archived === true}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-dashed border-line-2 px-2 py-0.5 text-[11px] text-ink-3 transition-colors",
              "hover:border-line-2 hover:bg-card-tint hover:text-ink",
              document.archived && "cursor-not-allowed opacity-50",
            )}
          >
            <Plus className="h-3 w-3" />
            {document.tags.length === 0 ? "Add tags" : "Add"}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 p-0"
          onOpenAutoFocus={(e) => {
            // We focus the input ourselves; prevent default to avoid
            // a fight with Radix focus management.
            e.preventDefault();
          }}
        >
          <TagInput
            current={document.tags}
            suggestions={existingTags ?? []}
            onAdd={addTag}
            onRemoveLast={() => {
              const last = document.tags[document.tags.length - 1];
              if (last) void removeTag(last);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TagPill({
  tag,
  onRemove,
  disabled,
}: {
  tag: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1 rounded-full bg-bg-2 px-2 py-0.5 text-[11px] font-medium text-ink-2",
        disabled && "opacity-60",
      )}
    >
      <TagIcon className="h-2.5 w-2.5 text-ink-3" />
      {tag}
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="text-ink-3 opacity-0 transition-opacity hover:text-fmu-red group-hover:opacity-100"
          aria-label={`Remove ${tag}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function TagInput({
  current,
  suggestions,
  onAdd,
  onRemoveLast,
}: {
  current: string[];
  suggestions: string[];
  onAdd: (tag: string) => void;
  onRemoveLast: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter suggestions: not already on document, matching current input.
  const filtered = useMemo(() => {
    const lower = value.trim().toLowerCase();
    const remaining = suggestions.filter((t) => !current.includes(t));
    if (!lower) return remaining.slice(0, 8);
    return remaining
      .filter((t) => t.includes(lower))
      .slice(0, 8);
  }, [suggestions, current, value]);

  function commit(raw: string) {
    onAdd(raw);
    setValue("");
    inputRef.current?.focus();
  }

  // Set focus on mount (since we prevented default focus management).
  function setInputRef(el: HTMLInputElement | null) {
    inputRef.current = el;
    if (el) el.focus();
  }

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "p-2",
          (filtered.length > 0 || value.trim() !== "") && "border-b border-line",
        )}
      >
        <input
          ref={setInputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a tag…"
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (value.trim()) commit(value);
            } else if (e.key === "Backspace" && value === "") {
              onRemoveLast();
            }
          }}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
        />
      </div>
      {(filtered.length > 0 || value.trim() !== "") && (
        <div className="max-h-56 overflow-y-auto p-1">
          {filtered.length === 0 && value.trim() !== "" && (
            <button
              type="button"
              onClick={() => commit(value)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-card-tint"
            >
              <Plus className="h-3.5 w-3.5 text-ink-3" />
              <span>
                Create <span className="font-medium">{value.trim()}</span>
              </span>
            </button>
          )}
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => commit(tag)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-card-tint"
            >
              <TagIcon className="h-3 w-3 text-ink-3" />
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
