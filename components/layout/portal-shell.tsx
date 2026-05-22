"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { UserMenu } from "./user-menu";
import { PortalSidebar } from "./portal-sidebar";
import type { ReactNode } from "react";

/**
 * Client-portal shell — green sibling of the firm shell.
 *
 *   ┌─────┬───────────────────────────────┐
 *   │ G   │  Top bar (brand · crumbs · U) │
 *   │ R   ├───────────────────────────────┤
 *   │ E   │                               │
 *   │ E   │  Page content                 │
 *   │ N   │                               │
 *   └─────┴───────────────────────────────┘
 *
 * Same shape as the firm `AppShell`; only the rail color changes. Lives
 * exclusively in `app/portal/layout.tsx` so it persists across navigations.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <PortalSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <PortalTopBar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────

type Crumb = { label: string; href?: string };

function PortalTopBar() {
  const pathname = usePathname() ?? "";
  const match = pathname.match(/^\/portal\/c\/([^/]+)(?:\/(.*))?$/);
  const customerId = match ? (match[1] as Id<"customers">) : null;
  const subSegment = match ? match[2]?.split("/")[0] : undefined;

  const customer = useQuery(
    api.customers.get,
    customerId ? { customerId } : "skip",
  );

  const crumbs: Crumb[] = [];
  if (customerId) {
    crumbs.push({
      label: customer?.name ?? "…",
      href: `/portal/c/${customerId}`,
    });
    if (subSegment) {
      crumbs.push({ label: titleCase(subSegment) });
    }
  } else if (pathname.startsWith("/portal/settings")) {
    crumbs.push({ label: "Settings" });
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b border-line bg-card px-6">
      <nav className="flex items-center gap-1.5 text-sm">
        {crumbs.length === 0 && <span className="text-ink-3">—</span>}
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-ink-4" aria-hidden />
            )}
            {c.href ? (
              <Link
                href={c.href}
                prefetch={false}
                className="text-ink-2 hover:text-ink"
              >
                {c.label}
              </Link>
            ) : (
              <span className="text-ink">{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>

      <div className="flex-1" />
      <UserMenu />
    </header>
  );
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ");
}
