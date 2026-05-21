"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { AppShell } from "@/components/layout/app-shell";
import type { Crumb } from "@/components/layout/top-bar";
import { useEnsureUser } from "@/hooks/use-ensure-user";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The firm-member shell.
 *
 *   • Gates: signed-in users only — signed-out → redirect to /
 *   • Provisions: calls `ensureUser` on auth ready
 *   • Renders: a single AppShell with breadcrumbs derived from the pathname
 *
 * Per the cockpit-v3 lesson, the shell lives only here so it persists
 * across page navigations within the (app) group (no remount on route change).
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();

  useEnsureUser();

  // Redirect signed-out users back to the landing page.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  // Look up the customer name (if any) for breadcrumb purposes.
  const customer = useQuery(
    api.customers.get,
    params?.id ? { customerId: params.id as Id<"customers"> } : "skip",
  );

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // useEffect will redirect
  }

  const crumbs = buildCrumbs(pathname, customer ?? undefined);

  return <AppShell crumbs={crumbs}>{children}</AppShell>;
}

function buildCrumbs(
  pathname: string,
  customer?: { _id: Id<"customers">; name: string },
): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  const crumbs: Crumb[] = [];

  switch (segments[0]) {
    case "customers": {
      crumbs.push({ label: "Customers", href: "/customers" });
      if (segments[1]) {
        crumbs.push({
          label: customer?.name ?? "Customer",
          href: `/customers/${segments[1]}`,
        });
        if (segments[2]) {
          crumbs.push({ label: titleCase(segments[2]) });
        }
      }
      break;
    }
    case "inbox":
      crumbs.push({ label: "Inbox" });
      break;
    case "calendar":
      crumbs.push({ label: "Calendar" });
      break;
    case "team":
      crumbs.push({ label: "Team chat" });
      break;
    case "settings":
      crumbs.push({ label: "Settings" });
      if (segments[1]) crumbs.push({ label: titleCase(segments[1]) });
      break;
    case "debug":
      crumbs.push({ label: "Debug" });
      break;
    default:
      crumbs.push({ label: titleCase(segments[0]) });
  }

  return crumbs;
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ");
}
