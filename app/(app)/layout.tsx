"use client";

import { useEffect, useMemo } from "react";
import { useRouter, usePathname, useParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { AppShell } from "@/components/layout/app-shell";
import { SuperadminBanner } from "@/components/layout/superadmin-banner";
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

  // Route users to the right surface based on their onboarding state.
  const onboardingState = useQuery(
    api.workspaces.onboardingState,
    isLoading || !isAuthenticated ? "skip" : {},
  );

  useEffect(() => {
    if (!onboardingState) return;
    if (onboardingState.state === "needs_workspace") {
      router.replace("/onboarding/create-workspace");
    } else if (onboardingState.state === "client_only") {
      router.replace("/portal");
    }
    // "superadmin_no_session" stays here for now — the superadmin banner
    // (next step) provides the workspace picker inline.
    // "has_workspace" — they belong; nothing to do.
  }, [onboardingState, router]);

  // Look up the customer name (if any) for breadcrumb purposes.
  const customer = useQuery(
    api.customers.get,
    params?.id ? { customerId: params.id as Id<"customers"> } : "skip",
  );

  // Detect deep customer sub-routes that have a per-entity leaf to fetch
  // (right now only /tasks/[taskId]). Add others here as routes grow.
  const segments = pathname.split("/").filter(Boolean);
  const taskIdSegment =
    segments[0] === "customers" && segments[2] === "tasks" && segments[3]
      ? (segments[3] as Id<"tasks">)
      : null;
  const task = useQuery(
    api.tasks.get,
    taskIdSegment ? { taskId: taskIdSegment } : "skip",
  );

  const crumbs = useMemo(
    () =>
      buildCrumbs(pathname, customer ?? undefined, task?.title ?? undefined),
    [pathname, customer, task?.title],
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

  // While we're deciding where to send the user (no workspace, client-only),
  // show a neutral loading frame to avoid flashing the shell.
  if (
    onboardingState &&
    (onboardingState.state === "needs_workspace" ||
      onboardingState.state === "client_only")
  ) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <SuperadminBanner />
      <div className="min-h-0 flex-1">
        <AppShell crumbs={crumbs}>{children}</AppShell>
      </div>
    </div>
  );
}

function buildCrumbs(
  pathname: string,
  customer?: { _id: Id<"customers">; name: string },
  leafTitle?: string,
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
          // If we have a sub-page (e.g. /tasks/[taskId]), make the
          // section name itself a link and use the entity's title as the leaf.
          if (segments[3]) {
            crumbs.push({
              label: titleCase(segments[2]),
              href: `/customers/${segments[1]}/${segments[2]}`,
            });
            crumbs.push({
              label: leafTitle ?? titleCase(segments[2]).replace(/s$/, ""),
            });
          } else {
            crumbs.push({ label: titleCase(segments[2]) });
          }
        }
      }
      break;
    }
    case "calendar":
      crumbs.push({ label: "Calendar" });
      break;
    case "activity":
      crumbs.push({ label: "Client conversations" });
      break;
    case "settings":
      crumbs.push({ label: "Settings" });
      if (segments[1]) crumbs.push({ label: titleCase(segments[1]) });
      break;
    case "debug":
      crumbs.push({ label: "Debug" });
      break;
    case "admin":
      crumbs.push({ label: "Admin" });
      if (segments[1]) crumbs.push({ label: titleCase(segments[1]) });
      break;
    default:
      crumbs.push({ label: titleCase(segments[0]) });
  }

  return crumbs;
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ");
}
