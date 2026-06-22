"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { CalendarDays, FolderOpen, ListTodo, MessageSquare } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/**
 * Centered icon nav for the per-customer section. Lives on the customer-name
 * row of each customer page (home/documents/tasks/chat) — replaces the
 * customer-context block that used to sit in the left rail.
 */
export function CustomerTabs({ customerId }: { customerId: Id<"customers"> }) {
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

  return (
    <nav className="flex items-center gap-1 rounded-lg border border-line bg-card p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          prefetch={false}
          aria-label={t.label}
          title={t.label}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "flex h-7 w-9 items-center justify-center rounded-md transition-colors",
            t.active
              ? "bg-fmu-navy text-white"
              : "text-ink-3 hover:bg-card-tint hover:text-ink",
          )}
        >
          <t.icon className="h-4 w-4" />
        </Link>
      ))}
    </nav>
  );
}
