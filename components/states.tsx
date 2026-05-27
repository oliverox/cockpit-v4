import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline loading text. Pass `centered` to fill a flex parent's height. */
export function LoadingState({
  label = "Loading…",
  centered = false,
  className,
}: {
  label?: string;
  centered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm text-ink-3",
        centered && "flex h-full items-center justify-center",
        className,
      )}
    >
      {label}
    </div>
  );
}

/** Dashed, icon-topped empty / zero-state card. Standardises the rounded-2xl
 * dashed treatment used for "no X yet" placeholders. */
export function EmptyState({
  icon: Icon,
  children,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && <Icon className="mx-auto mb-3 h-6 w-6 text-ink-4" />}
      <p className="text-sm text-ink-3">{children}</p>
    </div>
  );
}
