"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Calendar,
  MessageCircle,
  Settings,
  Wrench,
  PlaneTakeoff,
} from "lucide-react";
import { RailButton } from "./rail-button";

/**
 * Primary (navy) left rail.
 *
 * Top-level only: Customers, Calendar, Client conversations, Debug, Settings.
 * Per-customer navigation (Calendar / Documents / Tasks / Chat) lives in the
 * customer page header (see `CustomerTabs`), not in this rail.
 */
export function LeftSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-14 flex-col items-center gap-2 bg-sidebar py-3 text-sidebar-foreground">
      {/* Brand mark */}
      <Link
        href="/customers"
        className="mb-1 flex h-10 w-10 items-center justify-center text-fmu-yellow"
        prefetch={false}
        aria-label="Cockpit"
      >
        <PlaneTakeoff className="h-5 w-5" />
      </Link>

      {/* Top-level nav */}
      <nav className="flex flex-col items-center gap-1">
        <RailButton
          href="/customers"
          icon={Users}
          label="Customers"
          active={pathname.startsWith("/customers")}
        />
        <RailButton
          href="/calendar"
          icon={Calendar}
          label="Calendar"
          active={pathname === "/calendar"}
        />
        <RailButton
          href="/activity"
          icon={MessageCircle}
          label="Client conversations"
          active={pathname.startsWith("/activity")}
        />
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom items */}
      <nav className="flex flex-col items-center gap-1">
        <RailButton
          href="/debug"
          icon={Wrench}
          label="Debug"
          tooltip="Phase 0 smoke tests"
          active={pathname.startsWith("/debug")}
        />
        <RailButton
          href="/settings"
          icon={Settings}
          label="Settings"
          active={pathname.startsWith("/settings")}
        />
      </nav>
    </aside>
  );
}
