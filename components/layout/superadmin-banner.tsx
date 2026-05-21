"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
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
 *   • "Switch" / "Pick workspace" links to /admin.
 *   • "Exit" ends the active session (caller reverts to their default
 *     identity — MemberActor if they have a membership, else null).
 */
export function SuperadminBanner() {
  const isSuperadmin = useQuery(api.superadmin.amISuperadmin);
  const whoAmI = useQuery(api.users.whoAmI);
  const workspace = useQuery(api.workspaces.getActive);
  const exit = useMutation(api.superadmin.exitWorkspace);

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
      <div className="flex items-center gap-1">
        <Button
          asChild
          size="xs"
          variant="ghost"
          className="text-fmu-navy hover:bg-fmu-navy/10 hover:text-fmu-navy"
        >
          <Link href="/admin" prefetch={false}>
            {inSession ? "Switch" : "Pick workspace"}
          </Link>
        </Button>
        {inSession && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void exit()}
            className="text-fmu-navy hover:bg-fmu-navy/10 hover:text-fmu-navy"
          >
            Exit
          </Button>
        )}
      </div>
    </div>
  );
}
