"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, Shield } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states";

/**
 * Superadmin console — lists every workspace in the system and lets the
 * superadmin enter one (creating an impersonation session). Gated by
 * `listAllWorkspaces`, which returns `null` for non-superadmins.
 */
export default function AdminWorkspacesPage() {
  const workspaces = useQuery(api.superadmin.listAllWorkspaces);
  const whoAmI = useQuery(api.users.whoAmI);
  const enterWorkspace = useMutation(api.superadmin.enterWorkspace);
  const router = useRouter();
  const [entering, setEntering] = useState<Id<"workspaces"> | null>(null);

  const activeWorkspaceId =
    whoAmI?.provisioned === true && whoAmI.actor?.kind === "superadmin"
      ? whoAmI.actor.activeWorkspaceId
      : null;

  async function onEnter(workspaceId: Id<"workspaces">) {
    setEntering(workspaceId);
    try {
      await enterWorkspace({ workspaceId });
      router.push("/customers");
    } catch (err) {
      console.error(err);
      setEntering(null);
    }
  }

  if (workspaces === undefined) {
    return <LoadingState className="p-8" />;
  }

  if (workspaces === null) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <h1 className="text-2xl font-semibold text-ink">Access denied</h1>
        <p className="mt-2 text-sm text-ink-3">
          This page is reserved for Cockpit staff.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-10 flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-fmu-navy text-fmu-yellow">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <div className="eyebrow">Superadmin</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            All workspaces
          </h1>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <p className="text-sm text-ink-3">No workspaces yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-bg-2">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Workspace
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Created
                </th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => {
                const isActive = w._id === activeWorkspaceId;
                const isEntering = entering === w._id;
                return (
                  <tr
                    key={w._id}
                    className="border-b border-line last:border-b-0 hover:bg-card-tint"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">
                          {w.name}
                        </span>
                        {isActive && (
                          <span className="pill pill--completed">Active</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="num text-sm text-ink-3">
                        {new Date(w._creationTime).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={isActive ? "outline" : "default"}
                        onClick={() => onEnter(w._id)}
                        disabled={entering !== null}
                      >
                        {isEntering
                          ? "Entering…"
                          : isActive
                            ? "Re-enter"
                            : "Enter"}
                        {!isEntering && <ArrowRight className="h-3.5 w-3.5" />}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
