"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  Home,
  ListChecks,
  MessageCircle,
  PlaneTakeoff,
  Settings,
} from "lucide-react";
import { RailButton } from "./rail-button";

/**
 * Client-portal left rail.
 *
 * Shape-identical to the firm `LeftSidebar` (56px wide, RailButton primitives,
 * brand mark at the top, settings at the bottom), themed green via the
 * `.portal-rail` class which scope-overrides the `--sidebar-*` CSS vars.
 *
 * Clients belong to one firm and (in the common case) one customer, so there's
 * no "companies" rail entry. Customer-scoped entries (Home / Documents / Tasks
 * / Messages) are visible whenever they're inside `/portal/c/[customerId]/...`.
 */
export function PortalSidebar() {
  const pathname = usePathname() ?? "";
  const match = pathname.match(/^\/portal\/c\/([^/]+)(?:\/.*)?$/);
  const customerId = match ? match[1] : null;
  const base = customerId ? `/portal/c/${customerId}` : null;

  return (
    <aside className="portal-rail flex h-full w-14 flex-col items-center gap-2 bg-sidebar py-3 text-sidebar-foreground">
      {/* Brand mark */}
      <Link
        href="/portal"
        className="mb-1 flex h-10 w-10 items-center justify-center text-fmu-yellow"
        prefetch={false}
        aria-label="Cockpit"
      >
        <PlaneTakeoff className="h-5 w-5" />
      </Link>

      {/* Customer-scoped nav */}
      {base && (
        <nav className="flex flex-col items-center gap-1">
          <RailButton
            href={base}
            icon={Home}
            label="Home"
            active={pathname === base}
          />
          <RailButton
            href={`${base}/documents`}
            icon={FolderOpen}
            label="Documents"
            active={pathname.startsWith(`${base}/documents`)}
          />
          <RailButton
            href={`${base}/tasks`}
            icon={ListChecks}
            label="Tasks"
            active={pathname.startsWith(`${base}/tasks`)}
          />
          <RailButton
            href={`${base}/messages`}
            icon={MessageCircle}
            label="Messages"
            active={pathname.startsWith(`${base}/messages`)}
          />
        </nav>
      )}

      <div className="flex-1" />

      {/* Bottom */}
      <nav className="flex flex-col items-center gap-1">
        <RailButton
          href="/portal/settings"
          icon={Settings}
          label="Settings"
          active={pathname.startsWith("/portal/settings")}
        />
      </nav>
    </aside>
  );
}
