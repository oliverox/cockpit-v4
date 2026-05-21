"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { OrganizationProfile } from "@clerk/nextjs";
import { Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";

export default function TeamSettingsPage() {
  const members = useQuery(api.team.listMembers, {});
  const updateRole = useMutation(api.team.updateRole);
  const updateScope = useMutation(api.team.updateScope);
  const [clerkOpen, setClerkOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Team
        </h1>
        <Button onClick={() => setClerkOpen(true)}>
          <Users className="h-4 w-4" />
          Manage members
        </Button>
      </div>

      <p className="max-w-2xl text-sm text-ink-3">
        Invitations and email-based membership are handled through Clerk.
        Click <strong className="text-ink">Manage members</strong> above
        to invite people; once they accept, their workspace membership is
        provisioned automatically on their next sign-in.
      </p>

      {members === undefined && (
        <p className="text-sm text-ink-3">Loading…</p>
      )}

      {members !== undefined && members.length === 0 && (
        <p className="text-sm text-ink-3">No members yet.</p>
      )}

      {members !== undefined && members.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-bg-2">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Member
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Role
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Scope
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.membershipId}
                  className={cn(
                    "border-b border-line last:border-b-0",
                    m.archived && "opacity-60",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <InitialsAvatar name={m.displayName} size="md" />
                      <div>
                        <div className="text-sm font-medium text-ink">
                          {m.displayName}
                          {m.kind === "ai" && (
                            <span className="ml-2 pill pill--neutral text-[10px]">
                              AI
                            </span>
                          )}
                        </div>
                        {m.email && (
                          <div className="text-xs text-ink-3">{m.email}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={m.role}
                      disabled={m.role === "owner"}
                      onChange={(e) =>
                        void updateRole({
                          membershipId: m.membershipId as Id<"memberships">,
                          role: e.target.value as
                            | "owner"
                            | "admin"
                            | "member",
                        }).catch(console.error)
                      }
                      className="rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy disabled:opacity-60"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={m.scope}
                      onChange={(e) =>
                        void updateScope({
                          membershipId: m.membershipId as Id<"memberships">,
                          scope: e.target.value as
                            | "all"
                            | "assigned_only",
                        }).catch(console.error)
                      }
                      className="rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy"
                    >
                      <option value="all">All customers</option>
                      <option value="assigned_only">Assigned only</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={clerkOpen} onOpenChange={setClerkOpen}>
        <DialogContent className="max-w-[860px] p-0">
          <DialogHeader className="border-b border-line px-6 py-4">
            <DialogTitle>Manage members</DialogTitle>
          </DialogHeader>
          <div className="bg-card p-4">
            <OrganizationProfile routing="hash" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
