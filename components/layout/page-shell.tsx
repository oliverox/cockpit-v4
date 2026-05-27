import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const SIZES = {
  /** Default working surface — full width, standard padding. */
  full: "w-full px-8 py-8",
  /** Narrow reading column (settings). */
  "3xl": "mx-auto max-w-3xl px-8 py-10",
  /** Wide reading column (admin / consoles). */
  "4xl": "mx-auto max-w-4xl px-8 py-10",
} as const;

/**
 * Standard page padding/width wrapper for firm-shell & portal pages. Replaces
 * the `w-full px-8 py-8` / `mx-auto max-w-3xl …` boilerplate that was repeated
 * on every page. Pair with `<PageHeader>`.
 */
export function PageShell({
  children,
  size = "full",
  className,
}: {
  children: ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return <div className={cn(SIZES[size], className)}>{children}</div>;
}
