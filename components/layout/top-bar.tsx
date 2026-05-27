"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { UserMenu } from "./user-menu";
import { api } from "@/convex/_generated/api";

export function TopBar() {
  const workspace = useQuery(api.workspaces.getActive);
  const name = workspace?.name ?? "Cockpit";

  return (
    <header className="relative flex h-14 items-center border-b border-line bg-card px-6">
      {/* Firm nameplate — a centered mono pressmark that doubles as the home
          link. The yellow lozenge echoes the brand accent on the rail; it
          pivots a quarter-turn on hover for a quiet bit of life. */}
      <Link
        href="/customers"
        prefetch={false}
        aria-label={`${name} — home`}
        title="Home"
        className="group absolute left-1/2 top-1/2 flex max-w-[44%] -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-md px-3 py-1.5 transition-colors hover:bg-card-tint"
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rotate-45 bg-fmu-yellow transition-transform duration-300 ease-out group-hover:rotate-[135deg] motion-reduce:transition-none"
        />
        <span className="truncate font-mono text-[12px] font-medium uppercase tracking-[0.2em] text-ink transition-colors group-hover:text-fmu-navy">
          {name}
        </span>
      </Link>

      <div className="flex-1" />
      <UserMenu />
    </header>
  );
}
