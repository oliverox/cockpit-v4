"use client";

import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";

type RailButtonProps = {
  href?: string;
  onClick?: () => void;
  active?: boolean;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Right-side tooltip label, defaults to `label`. */
  tooltip?: ReactNode;
};

/**
 * Single primitive used in both the primary (navy) left rail and the
 * future secondary right rail. A 40×40 square button with an icon, a
 * subtle active state, and a tooltip popping out to the right.
 */
export function RailButton({
  href,
  onClick,
  active,
  label,
  icon: Icon,
  tooltip,
}: RailButtonProps) {
  const inner = (
    <span
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
        "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-ring/40",
      )}
      aria-label={label}
    >
      <Icon className="h-5 w-5" />
    </span>
  );

  const node = href ? (
    <Link href={href} className="block" prefetch={false}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className="block">
      {inner}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {tooltip ?? label}
      </TooltipContent>
    </Tooltip>
  );
}
