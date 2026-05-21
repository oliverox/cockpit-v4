"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useQuery } from "convex/react";
import { UserMenu } from "./user-menu";
import { Fragment } from "react";
import { api } from "@/convex/_generated/api";

export type Crumb = {
  label: string;
  href?: string;
};

type TopBarProps = {
  crumbs: Crumb[];
};

export function TopBar({ crumbs }: TopBarProps) {
  const workspace = useQuery(api.workspaces.getActive);

  return (
    <header className="flex h-14 items-center gap-4 border-b border-line bg-card px-6">
      {/* Workspace name (falls back to "Cockpit" while loading or pre-onboarding) */}
      <Link
        href="/customers"
        className="text-sm font-semibold tracking-tight text-fmu-navy"
        prefetch={false}
      >
        {workspace?.name ?? "Cockpit"}
      </Link>

      <span className="text-ink-4">/</span>

      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm">
        {crumbs.length === 0 && (
          <span className="text-ink-3">—</span>
        )}
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-ink-4" aria-hidden />
            )}
            {c.href ? (
              <Link
                href={c.href}
                className="text-ink-2 hover:text-ink"
                prefetch={false}
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

      {/* User menu */}
      <UserMenu />
    </header>
  );
}
