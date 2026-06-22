import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Consistent page header. Covers the shapes used across the app:
 *
 *   eyebrow?  → small mono caption above the title
 *   backHref? → animated back-arrow link to the left of the title
 *   count?    → mono count chip beside the title
 *   badge?    → status pill beside the title (e.g. "Archived")
 *   meta?     → chips/row beneath the title
 *   description? → muted sentence beneath the title
 *   actions?  → right-aligned controls (buttons, toggles, search)
 *
 * Spacing: defaults to `mb-6`. When the page spaces its children with a
 * `space-y-*` container, pass `className="mb-0"` and let the container space.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  backHref,
  backLabel = "Back",
  count,
  badge,
  center,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  count?: number;
  badge?: ReactNode;
  /** Centered content on the header row (e.g. a section tab nav). */
  center?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative mb-6 flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <div className={cn("flex items-center gap-2.5", eyebrow && "mt-1")}>
          {backHref && (
            <Link
              href={backHref}
              prefetch={false}
              aria-label={backLabel}
              title={backLabel}
              className="group -ml-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-card-tint hover:text-ink"
            >
              <ArrowLeft className="h-5 w-5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5 motion-reduce:transform-none" />
            </Link>
          )}
          <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {typeof count === "number" && (
            <span className="num shrink-0 rounded-full bg-bg-2 px-2 py-0.5 text-xs text-ink-3">
              {count}
            </span>
          )}
          {badge && <span className="shrink-0">{badge}</span>}
        </div>
        {meta && <div className="mt-2">{meta}</div>}
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-ink-3">{description}</p>
        )}
      </div>
      {center && (
        <div className="absolute left-1/2 top-0 hidden -translate-x-1/2 lg:block">
          {center}
        </div>
      )}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}
