"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Mail, ShieldOff, UserMinus, UserPlus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";

export default function TeamSettingsPage() {
  const members = useQuery(api.team.listMembers, {});
  const invites = useQuery(api.team.listTeamInvites, {});
  const updateRole = useMutation(api.team.updateRole);
  const updateScope = useMutation(api.team.updateScope);
  const archiveMember = useMutation(api.team.archiveMember);
  const inviteTeamMember = useMutation(api.team.inviteTeamMember);
  const cancelTeamInvite = useMutation(api.team.cancelTeamInvite);

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setHint(null);
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const result = await inviteTeamMember({ email: trimmed });
      setEmail("");
      if (result.kind === "linked") {
        setHint("Member added — they're in the firm.");
      } else if (result.kind === "already_linked") {
        setHint("That email is already a member of this firm.");
      } else if (result.kind === "already_invited") {
        setHint("That email is already invited and pending.");
      } else {
        setHint(
          "Invite sent. They'll join the firm the first time they sign in.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 px-8 py-10">
      <header>
        <div className="eyebrow">Settings</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          Team
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Everyone with access to this firm. Invite by email — they'll get a
          magic-link to set up their account.
        </p>
      </header>

      <form onSubmit={onInvite} className="flex items-center gap-2">
        <Input
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={sending}
          required
          className="h-10"
        />
        <Button type="submit" disabled={sending || !email.trim()}>
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          Invite member
        </Button>
      </form>

      {hint && (
        <div className="rounded-md border border-fmu-green/30 bg-fmu-green/5 px-3 py-2 text-[12px] text-fmu-green">
          {hint}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-fmu-red/30 bg-fmu-red/5 px-3 py-2 text-[12px] text-fmu-red">
          {error}
        </div>
      )}

      <Section title="Members">
        {members === undefined ? (
          <Loading />
        ) : members.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-bg-2">
                  <Th>Member</Th>
                  <Th>Role</Th>
                  <Th>Scope</Th>
                  <th className="px-4 py-2.5" />
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
                            role: e.target.value as "owner" | "member",
                          }).catch(console.error)
                        }
                        className="rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy disabled:opacity-60"
                      >
                        <option value="owner">Owner</option>
                        <option value="member">Member</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={m.scope}
                        disabled={m.role === "owner"}
                        onChange={(e) =>
                          void updateScope({
                            membershipId: m.membershipId as Id<"memberships">,
                            scope: e.target.value as "all" | "assigned_only",
                          }).catch(console.error)
                        }
                        className="rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-fmu-navy disabled:opacity-60"
                      >
                        <option value="all">All customers</option>
                        <option value="assigned_only">Assigned only</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.role !== "owner" && !m.archived && (
                        <button
                          type="button"
                          onClick={() =>
                            void archiveMember({
                              membershipId:
                                m.membershipId as Id<"memberships">,
                            }).catch((err) =>
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Could not remove",
                              ),
                            )
                          }
                          className="text-ink-4 hover:text-fmu-red"
                          aria-label="Remove member"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {invites && invites.length > 0 && (
        <Section title="Pending invites">
          <ul className="divide-y divide-line rounded-lg border border-dashed border-line">
            {invites.map((i) => (
              <li
                key={i.inviteId}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <Mail className="h-3.5 w-3.5 text-ink-3" />
                <div className="min-w-0 flex-1 truncate text-sm text-ink-2">
                  {i.email}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-ink-3">
                  {i.role}
                </span>
                {i.clerkInviteError && (
                  <span className="truncate text-[10px] text-fmu-red">
                    email failed
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void cancelTeamInvite({
                      inviteId: i.inviteId as Id<"team_invites">,
                    }).catch((err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Could not cancel",
                      ),
                    )
                  }
                  className="text-ink-4 hover:text-fmu-red"
                  aria-label="Cancel invite"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
        {title}
      </div>
      {children}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
      {children}
    </th>
  );
}

function Loading() {
  return <p className="text-sm text-ink-3">Loading…</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-3 py-3 text-[12px] text-ink-3">
      {children}
    </div>
  );
}
