"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { PortalShell } from "@/components/layout/portal-shell";
import { useEnsureUser } from "@/hooks/use-ensure-user";

/**
 * Client portal layout. Auth-gates and provisions the user, then renders the
 * portal shell.
 *
 * Phase 0 doesn't yet distinguish firm members from clients here — anyone
 * signed in can visit /portal/*. Phase 3 will redirect firm members back to
 * /customers and only let actual client users in.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();

  useEnsureUser();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-ink-3">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <PortalShell>{children}</PortalShell>;
}
