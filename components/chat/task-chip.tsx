"use client";

import Link from "next/link";
import { Hash, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type Tone = "active" | "neutral";
export type ChatSurface = "firm" | "portal";

export function TaskChip({
  taskId,
  customerId,
  title,
  tone = "neutral",
  surface = "firm",
  href,
  onRemove,
  onSelect,
}: {
  taskId: Id<"tasks">;
  customerId: Id<"customers">;
  title: string;
  tone?: Tone;
  surface?: ChatSurface;
  href?: string;
  onRemove?: () => void;
  /** When provided, clicking the chip calls this instead of navigating. */
  onSelect?: () => void;
}) {
  const defaultHref =
    surface === "portal"
      ? `/portal/c/${customerId}/tasks/${taskId}`
      : `/customers/${customerId}/tasks/${taskId}`;
  const target = href ?? defaultHref;
  const colorClasses =
    tone === "active"
      ? "bg-fmu-navy text-white hover:bg-fmu-navy-2"
      : "bg-fmu-navy/10 text-fmu-navy hover:bg-fmu-navy/15";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md py-0.5 pl-1.5 pr-1 align-baseline text-[12px] font-medium leading-snug",
        colorClasses,
      )}
    >
      <Hash className="h-3 w-3 shrink-0 opacity-70" />
      {onSelect ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
          }}
          className="min-w-0 truncate pr-0.5 hover:underline"
        >
          {title}
        </button>
      ) : (
        <Link
          href={target}
          prefetch={false}
          className="min-w-0 truncate pr-0.5 hover:underline"
        >
          {title}
        </Link>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-fmu-navy/15"
          aria-label="Remove task reference"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
