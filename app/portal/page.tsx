"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowRight, Building2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

/**
 * Portal home — customer picker.
 *
 * A signed-in client may have access to one or more customers. When they have
 * exactly one, this page transparently redirects to that customer's home —
 * no friction. The picker only appears for clients who manage multiple.
 */
export default function PortalHomePage() {
  const router = useRouter();
  const customers = useQuery(api.customers.list, {});

  useEffect(() => {
    if (customers && customers.length === 1) {
      router.replace(`/portal/c/${customers[0]._id}`);
    }
  }, [customers, router]);

  // While the query is in flight, or while we're auto-redirecting a
  // single-customer client, show a quiet loader instead of flashing the picker.
  if (customers === undefined || customers.length === 1) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  return (
    <div className="w-full px-8 py-8">
      <header className="mb-8">
        <div className="eyebrow">Portal</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          Choose a company
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Pick the company whose tasks and documents you want to view.
        </p>
      </header>

      {customers.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-6 py-8 text-center">
          <Building2 className="mx-auto mb-3 h-6 w-6 text-ink-4" />
          <p className="text-sm text-ink-3">
            No companies yet. You'll see them here once you've been invited.
          </p>
        </div>
      )}
      {customers.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
          {customers.map((c) => (
            <li key={c._id}>
              <Link
                href={`/portal/c/${c._id}`}
                prefetch={false}
                className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-card-tint"
              >
                <Building2 className="h-4 w-4 shrink-0 text-fmu-navy" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink group-hover:text-fmu-navy">
                    {c.name}
                  </div>
                  {c.metadata?.brn && (
                    <div className="num truncate text-[11px] text-ink-3">
                      BRN {c.metadata.brn}
                    </div>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-4 transition-colors group-hover:text-fmu-navy" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
