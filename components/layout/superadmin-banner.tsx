"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

/**
 * Persistent banner shown above the firm shell whenever the current user
 * is a superadmin. Surfaces the impersonation context explicitly so they
 * never forget they have elevated privileges.
 *
 *   • Always-on for any superadmin (even when acting as themselves in
 *     their own workspace) — visual reminder of the capability.
 *   • Shows "Viewing as <Workspace>" when a session is active.
 *   • A single "Change workspace" / "Pick workspace" link to /admin — the
 *     superadmin's only action is moving between workspaces (entering a new
 *     one replaces the active session).
 */
export function SuperadminBanner() {
  const isSuperadmin = useQuery(api.superadmin.amISuperadmin);
  const whoAmI = useQuery(api.users.whoAmI);
  const workspace = useQuery(api.workspaces.getActive);

  if (isSuperadmin !== true) return null;

  const inSession =
    whoAmI?.provisioned === true &&
    whoAmI.actor?.kind === "superadmin" &&
    whoAmI.actor.activeWorkspaceId !== null;

  const workspaceName = inSession ? (workspace?.name ?? "Loading…") : null;

  return (
    <div className="flex h-9 items-center justify-between gap-3 bg-fmu-yellow px-6 text-fmu-navy">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Shield className="h-3.5 w-3.5" />
        <span className="font-semibold">Superadmin</span>
        {inSession ? (
          <>
            <span className="text-fmu-navy/40">·</span>
            <span className="text-fmu-navy/80">Viewing as</span>
            <span className="font-semibold">{workspaceName}</span>
          </>
        ) : (
          <>
            <span className="text-fmu-navy/40">·</span>
            <span className="text-fmu-navy/80">
              Acting as yourself. Pick a workspace to impersonate.
            </span>
          </>
        )}
      </div>
      <Button
        asChild
        size="xs"
        variant="ghost"
        className="text-fmu-navy hover:bg-fmu-navy/10 hover:text-fmu-navy"
      >
        <Link href="/admin" prefetch={false}>
          {inSession ? "Change workspace" : "Pick workspace"}
        </Link>
      </Button>
    </div>
  );
}
