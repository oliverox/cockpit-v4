"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { Fraunces } from "next/font/google";
import { PlaneTakeoff } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useEnsureUser } from "@/hooks/use-ensure-user";
import { Button } from "@/components/ui/button";

const fraunces = Fraunces({
  variable: "--font-serif-raw",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/**
 * Onboarding shell. Used for /onboarding/* routes.
 *
 *   • Auth-gated. Signed-out → redirect to /.
 *   • Provisions the Convex `users` row.
 *   • Routes to /customers if the user already has a workspace,
 *     to /portal if they only have client_access.
 *
 * Visually distinct from the main AppShell: full-bleed canvas,
 * floating header, serif display type (Fraunces) scoped here only.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const { signOut } = useClerk();
  useEnsureUser();

  const onboardingState = useQuery(
    api.workspaces.onboardingState,
    isLoading || !isAuthenticated ? "skip" : {},
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!onboardingState) return;
    if (onboardingState.state === "has_workspace") {
      router.replace("/customers");
    } else if (onboardingState.state === "client_only") {
      router.replace("/portal");
    }
  }, [onboardingState, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  return (
    <div className={`${fraunces.variable} relative min-h-screen bg-background`}>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-6 lg:px-10">
        <Link
          href="/onboarding/create-workspace"
          className="pointer-events-auto flex items-center gap-2 text-sm font-semibold tracking-tight text-fmu-navy"
          prefetch={false}
        >
          <PlaneTakeoff className="h-4 w-4" />
          Cockpit
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="pointer-events-auto text-ink-3 hover:text-ink"
          onClick={() => void signOut({ redirectUrl: "/" })}
        >
          Sign out
        </Button>
      </header>
      <main className="min-h-screen">{children}</main>
    </div>
  );
}
