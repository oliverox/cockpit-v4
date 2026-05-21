"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderOpen, ListChecks, MessageCircle, PlaneTakeoff } from "lucide-react";
import { UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";

/**
 * Client portal shell.
 *
 * Distinct from the firm-member shell on purpose — clients see a simpler,
 * non-technical interface. Top bar (brand + UserMenu) and a horizontal tab
 * nav are all the chrome they get; the rest is content.
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  Cockpit · facture.mu                                  ●  │ ← top bar
 *   ├───────────────────────────────────────────────────────────┤
 *   │  Home   Documents   Tasks   Messages                      │ ← tabs
 *   ├───────────────────────────────────────────────────────────┤
 *   │                                                           │
 *   │  Main content                                             │
 *   │                                                           │
 *   └───────────────────────────────────────────────────────────┘
 */
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PortalTopBar />
      <PortalTabs />
      <main className="flex-1">{children}</main>
    </div>
  );
}

function PortalTopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-card px-6">
      <Link
        href="/portal"
        className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fmu-navy"
        prefetch={false}
      >
        <PlaneTakeoff className="h-4 w-4" />
        Cockpit
      </Link>
      <UserMenu />
    </header>
  );
}

type Tab = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const tabs: Tab[] = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/documents", label: "Documents", icon: FolderOpen },
  { href: "/portal/tasks", label: "Tasks", icon: ListChecks },
  { href: "/portal/messages", label: "Messages", icon: MessageCircle },
];

function PortalTabs() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-line bg-card">
      <div className="mx-auto flex h-11 max-w-5xl items-center gap-1 px-6">
        {tabs.map((t) => {
          const active =
            t.href === "/portal"
              ? pathname === "/portal"
              : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              prefetch={false}
              className={cn(
                "relative flex h-11 items-center gap-2 px-3 text-sm transition-colors",
                active
                  ? "text-ink"
                  : "text-ink-3 hover:text-ink-2",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {active && (
                <span
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-fmu-navy"
                  aria-hidden
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
