"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Building2, LayoutGrid, List, Plus } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";
const VIEW_KEY = "cockpit.customers.view";

export default function CustomersPage() {
  const customers = useQuery(api.customers.list, {});
  const [dialogOpen, setDialogOpen] = useState(false);

  const [view, setViewState] = useState<ViewMode>("grid");
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY) as ViewMode | null;
    if (saved === "grid" || saved === "list") setViewState(saved);
  }, []);
  const setView = (v: ViewMode) => {
    setViewState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_KEY, v);
    }
  };

  return (
    <div className="w-full px-8 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Customers
        </h1>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            New customer
          </Button>
        </div>
      </header>

      <CustomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {customers === undefined && (
        <div className="text-sm text-ink-3">Loading…</div>
      )}

      {customers !== undefined && customers.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-6 py-10 text-center">
          <Building2 className="mx-auto mb-3 h-6 w-6 text-ink-4" />
          <p className="text-sm text-ink-3">No customers yet.</p>
        </div>
      )}

      {customers !== undefined && customers.length > 0 && (
        view === "grid" ? (
          <GridView customers={customers} />
        ) : (
          <ListView customers={customers} />
        )
      )}
    </div>
  );
}

// ── View toggle ────────────────────────────────────────────────────────

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line">
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
          view === "grid"
            ? "bg-fmu-navy text-white"
            : "bg-card text-ink-2 hover:bg-card-tint",
        )}
        aria-label="Grid view"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Grid
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
          view === "list"
            ? "bg-fmu-navy text-white"
            : "bg-card text-ink-2 hover:bg-card-tint",
        )}
        aria-label="List view"
      >
        <List className="h-3.5 w-3.5" />
        List
      </button>
    </div>
  );
}

// ── Grid view ──────────────────────────────────────────────────────────

function GridView({ customers }: { customers: Doc<"customers">[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {customers.map((c) => (
        <Link
          key={c._id}
          href={`/customers/${c._id}`}
          prefetch={false}
          className={cn(
            "group flex flex-col rounded-2xl border border-line bg-card p-5 transition-colors hover:border-line-2 hover:bg-card-tint",
            c.archived && "opacity-60",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-fmu-navy" />
            {c.archived && (
              <span className="pill pill--neutral">Archived</span>
            )}
          </div>
          <div className="mt-3 truncate text-base font-semibold text-ink group-hover:text-fmu-navy">
            {c.name}
          </div>
          <div className="mt-1.5 space-y-0.5">
            {c.metadata?.brn && (
              <div className="num truncate text-[11px] text-ink-3">
                BRN {c.metadata.brn}
              </div>
            )}
            {c.metadata?.primaryContactEmail && (
              <div className="truncate text-[11px] text-ink-3">
                {c.metadata.primaryContactEmail}
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── List view ──────────────────────────────────────────────────────────

function ListView({ customers }: { customers: Doc<"customers">[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line bg-bg-2">
            <Th>Name</Th>
            <Th>BRN</Th>
            <Th>Contact</Th>
            <Th align="right">Added</Th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c, i) => (
            <tr
              key={c._id}
              className={cn(
                "border-b border-line last:border-b-0 hover:bg-card-tint",
                c.archived && "opacity-60",
                i % 2 === 1 && "bg-card-tint/30",
              )}
            >
              <td className="px-4 py-2.5">
                <Link
                  href={`/customers/${c._id}`}
                  prefetch={false}
                  className="flex items-center gap-2 text-sm font-medium text-ink hover:text-fmu-navy"
                >
                  <Building2 className="h-3.5 w-3.5 text-ink-3" />
                  <span className="truncate">{c.name}</span>
                  {c.archived && (
                    <span className="pill pill--neutral">Archived</span>
                  )}
                </Link>
              </td>
              <td className="num px-4 py-2.5 text-xs text-ink-3">
                {c.metadata?.brn ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-xs text-ink-3">
                {c.metadata?.primaryContactEmail ?? "—"}
              </td>
              <td className="num px-4 py-2.5 text-right text-xs text-ink-3">
                {formatDate(c._creationTime)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-3",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}
