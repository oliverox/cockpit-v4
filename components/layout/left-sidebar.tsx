"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  Users,
  Calendar,
  MessageCircle,
  Settings,
  FolderOpen,
  ListTodo,
  MessageSquare,
  Wrench,
  PlaneTakeoff,
} from "lucide-react";
import { RailButton } from "./rail-button";

/**
 * Primary (navy) left rail.
 *
 * Top-level (always visible): Customers, Calendar, Settings.
 * When inside a customer (/customers/[id]/...), additional customer-context
 * entries appear: Documents, Tasks, Chat. The customer-home (calendar +
 * tasks panel) is reached via the breadcrumb / customer name itself.
 */
export function LeftSidebar() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const customerId = params?.id;
  const inCustomerContext =
    pathname.startsWith("/customers/") && Boolean(customerId);

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
          active={pathname === "/customers" || (pathname.startsWith("/customers/") && !inCustomerContext)}
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

      {/* Customer-context section */}
      {inCustomerContext && (
        <>
          <div className="my-2 h-px w-6 bg-sidebar-border" aria-hidden />
          <nav className="flex flex-col items-center gap-1">
            <RailButton
              href={`/customers/${customerId}/documents`}
              icon={FolderOpen}
              label="Documents"
              active={pathname.startsWith(`/customers/${customerId}/documents`)}
            />
            <RailButton
              href={`/customers/${customerId}/tasks`}
              icon={ListTodo}
              label="Tasks"
              active={pathname.startsWith(`/customers/${customerId}/tasks`)}
            />
            <RailButton
              href={`/customers/${customerId}/chat`}
              icon={MessageSquare}
              label="Chat"
              active={pathname.startsWith(`/customers/${customerId}/chat`)}
            />
          </nav>
        </>
      )}

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
