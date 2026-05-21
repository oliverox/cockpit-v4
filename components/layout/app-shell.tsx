"use client";

import { LeftSidebar } from "./left-sidebar";
import { TopBar, type Crumb } from "./top-bar";
import type { ReactNode } from "react";

type AppShellProps = {
  crumbs: Crumb[];
  children: ReactNode;
};

/**
 * The firm-member shell. Lives only in app/(app)/layout.tsx — never in pages.
 *
 *   ┌─────┬─────────────────────────────────┐
 *   │ L   │  Top bar                        │
 *   │ e   ├─────────────────────────────────┤
 *   │ f   │                                 │
 *   │ t   │  Main content (children)        │
 *   │     │                                 │
 *   │ R   │                                 │
 *   │ a   │                                 │
 *   │ i   │                                 │
 *   │ l   │                                 │
 *   └─────┴─────────────────────────────────┘
 *
 * Phase 0 leaves the right rail (Control Tower + tools) off. Added in a
 * later phase when the AI surface is wired.
 */
export function AppShell({ crumbs, children }: AppShellProps) {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <LeftSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar crumbs={crumbs} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
