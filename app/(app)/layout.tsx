"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingState } from "@/components/states";
import { SuperadminBanner } from "@/components/layout/superadmin-banner";
import { useEnsureUser } from "@/hooks/use-ensure-user";
import { api } from "@/convex/_generated/api";

/**
 * The firm-member shell.
 *
 *   • Gates: signed-in users only — signed-out → redirect to /
 *   • Provisions: calls `ensureUser` on auth ready
 *   • Renders: a single AppShell (top bar shows the firm name, centered)
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
    // provides the workspace picker inline.
    // "has_workspace" — they belong; nothing to do.
  }, [onboardingState, router]);

  if (isLoading) {
    return <LoadingState centered className="h-screen bg-background" />;
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
    return <LoadingState centered className="h-screen bg-background" />;
  }

  return (
    <div className="flex h-screen flex-col">
      <SuperadminBanner />
      <div className="min-h-0 flex-1">
        <AppShell>{children}</AppShell>
      </div>
    </div>
  );
}
