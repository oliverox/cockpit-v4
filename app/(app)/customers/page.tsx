"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Building2,
  LayoutGrid,
  List,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { formatDate, initials } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { EmptyState, LoadingState } from "@/components/states";

type ViewMode = "grid" | "list";
const VIEW_KEY = "cockpit.customers.view";

export default function CustomersPage() {
  const customers = useQuery(api.customers.list, {});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");

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

  const filtered = useMemo(() => {
    if (!customers) return undefined;
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const haystack = [
        c.name,
        c.metadata?.brn,
        c.metadata?.primaryContactEmail,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [customers, query]);

  const hasCustomers = customers !== undefined && customers.length > 0;

  return (
    <div className="w-full px-8 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Customers
          </h1>
          {customers !== undefined && (
            <span className="num rounded-full bg-bg-2 px-2 py-0.5 text-xs text-ink-3">
              {customers.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {hasCustomers && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customers"
                aria-label="Search customers"
                className="h-10 w-56 rounded-md border border-line bg-card pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-fmu-navy/50 focus:ring-2 focus:ring-fmu-navy/10"
              />
            </div>
          )}
          <ViewToggle view={view} onChange={setView} />
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            New customer
          </Button>
        </div>
      </header>

      <CustomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {customers === undefined && <LoadingState />}

      {customers !== undefined && customers.length === 0 && (
        <EmptyState icon={Building2}>
          No customers yet — add your first with{" "}
          <span className="font-medium text-ink-2">New customer</span>.
        </EmptyState>
      )}

      {hasCustomers && filtered && filtered.length === 0 && (
        <EmptyState icon={Search}>
          No customers match{" "}
          <span className="font-medium text-ink-2">“{query.trim()}”</span>.
        </EmptyState>
      )}

      {hasCustomers &&
        filtered &&
        filtered.length > 0 &&
        (view === "grid" ? (
          <GridView customers={filtered} />
        ) : (
          <ListView customers={filtered} />
        ))}
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
    <div className="inline-flex h-10 items-stretch overflow-hidden rounded-md border border-line">
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={cn(
          "inline-flex items-center gap-2 px-3.5 text-sm font-medium transition-colors",
          view === "grid"
            ? "bg-fmu-navy text-white"
            : "bg-card text-ink-2 hover:bg-card-tint",
        )}
        aria-label="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
        Grid
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={cn(
          "inline-flex items-center gap-2 border-l border-line px-3.5 text-sm font-medium transition-colors",
          view === "list"
            ? "bg-fmu-navy text-white"
            : "bg-card text-ink-2 hover:bg-card-tint",
        )}
        aria-label="List view"
      >
        <List className="h-4 w-4" />
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
            "group relative flex flex-col rounded-2xl border border-line bg-card p-5 transition-all duration-200",
            "hover:-translate-y-0.5 hover:border-line-2 hover:bg-card-tint hover:shadow-[0_10px_30px_-16px_rgba(9,36,72,0.28)]",
            "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
            c.archived && "opacity-60",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <Monogram name={c.name} />
            <div className="flex items-center gap-2">
              {c.archived && (
                <span className="pill pill--neutral">Archived</span>
              )}
              <ArrowUpRight
                className="h-4 w-4 -translate-x-1 text-ink-4 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-fmu-navy group-hover:opacity-100 motion-reduce:transition-none"
                aria-hidden
              />
            </div>
          </div>
          <div className="mt-4 truncate text-base font-semibold text-ink transition-colors group-hover:text-fmu-navy">
            {c.name}
          </div>
          <div className="mt-1 space-y-0.5">
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

/** Initials tile — gives each customer a stable identity mark, set in the
 * mono face that defines the app's numeric / nameplate voice. */
function Monogram({ name }: { name: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fmu-navy/[0.06] font-mono text-sm font-semibold tracking-wide text-fmu-navy transition-colors group-hover:bg-fmu-navy/[0.10]">
      {initials(name)}
    </span>
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
