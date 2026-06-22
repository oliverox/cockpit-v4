"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  CalendarDays,
  FolderOpen,
  ListTodo,
  MessageSquare,
  Puzzle,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import type { NavEntry } from "@/modules/types";
import { cn } from "@/lib/utils";

/**
 * Centered icon nav for the per-customer section. Lives on the customer-name
 * row of each customer page (home/documents/tasks/chat) — replaces the
 * customer-context block that used to sit in the left rail.
 *
 * `moduleNav` are the nav entries contributed by the workspace's active
 * modules (resolved by CustomerHeader from the registry). They render after
 * the four core tabs, separated by a divider, and appear/disappear as modules
 * are toggled in /settings/modules.
 */
export function CustomerTabs({
  customerId,
  moduleNav = [],
}: {
  customerId: Id<"customers">;
  moduleNav?: Array<NavEntry & { moduleId: string }>;
}) {
  const pathname = usePathname();
  const base = `/customers/${customerId}`;

  const tabs: {
    href: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    active: boolean;
  }[] = [
    { href: base, icon: CalendarDays, label: "Calendar", active: pathname === base },
    {
      href: `${base}/documents`,
      icon: FolderOpen,
      label: "Documents",
      active: pathname.startsWith(`${base}/documents`),
    },
    {
      href: `${base}/tasks`,
      icon: ListTodo,
      label: "Tasks",
      active: pathname.startsWith(`${base}/tasks`),
    },
    {
      href: `${base}/chat`,
      icon: MessageSquare,
      label: "Chat",
      active: pathname.startsWith(`${base}/chat`),
    },
  ];

  const moduleTabs = moduleNav.map((entry) => {
    const href = `${base}/${entry.href}`;
    return {
      href,
      icon: entry.icon ?? Puzzle,
      label: entry.label,
      active: pathname.startsWith(href),
    };
  });

  return (
    <nav className="flex items-center gap-1 rounded-lg border border-line bg-card p-1">
      {tabs.map((t) => (
        <TabLink key={t.href} {...t} />
      ))}
      {moduleTabs.length > 0 && (
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      )}
      {moduleTabs.map((t) => (
        <TabLink key={t.href} {...t} />
      ))}
    </nav>
  );
}

function TabLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 w-9 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-fmu-navy text-white"
          : "text-ink-3 hover:bg-card-tint hover:text-ink",
      )}
    >
      <Icon className="h-4 w-4" />
    </Link>
  );
}
