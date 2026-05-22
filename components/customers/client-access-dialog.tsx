"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Mail, ShieldOff, UserMinus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InitialsAvatar } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: Id<"customers">;
  customerName: string;
};

export function ClientAccessDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
}: Props) {
  const data = useQuery(
    api.customers.listClientAccess,
    open ? { customerId } : "skip",
  );
  const invite = useMutation(api.customers.inviteClient);
  const revoke = useMutation(api.customers.revokeClientAccess);
  const cancelInvite = useMutation(api.customers.cancelClientInvite);

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setHint(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const result = await invite({ customerId, email: trimmed });
      setEmail("");
      if (result.kind === "linked") {
        setHint("Client added — they have portal access immediately.");
      } else if (result.kind === "already_linked") {
        setHint("That client already has access to this customer.");
      } else if (result.kind === "already_invited") {
        setHint("That email is already invited and pending.");
      } else {
        setHint(
          "Invite recorded. They'll get portal access the first time they sign in.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Client access</DialogTitle>
          <DialogDescription>
            People who can sign into the portal for{" "}
            <span className="font-medium text-ink">{customerName}</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onInvite} className="flex items-center gap-2">
          <Input
            type="email"
            placeholder="client@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
            required
            className="h-9"
          />
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
            Invite
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

        <div className="space-y-3">
          <Section title="With portal access">
            {!data ? (
              <SkeletonRow />
            ) : data.active.length === 0 ? (
              <Empty>No clients have access yet.</Empty>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {data.active.map((row) => (
                  <li
                    key={row.accessId}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <InitialsAvatar name={row.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">
                        {row.displayName}
                      </div>
                      {row.email && (
                        <div className="truncate text-[11px] text-ink-3">
                          {row.email}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-ink-3">
                      {row.role === "client_owner" ? "Owner" : "Viewer"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void revoke({ accessId: row.accessId }).catch(
                          (err) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Could not revoke",
                            ),
                        )
                      }
                      className="text-ink-4 hover:text-fmu-red"
                      aria-label="Revoke access"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data && data.pending.length > 0 && (
            <Section title="Pending invites">
              <ul className="divide-y divide-line rounded-lg border border-dashed border-line">
                {data.pending.map((p) => (
                  <li
                    key={p.inviteId}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <Mail className="h-3.5 w-3.5 text-ink-3" />
                    <div className="min-w-0 flex-1 truncate text-sm text-ink-2">
                      {p.email}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-ink-3">
                      {p.role === "client_owner" ? "Owner" : "Viewer"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void cancelInvite({ inviteId: p.inviteId }).catch(
                          (err) =>
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
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className={cn("text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3")}>
        {title}
      </div>
      {children}
    </section>
  );
}

function SkeletonRow() {
  return (
    <div className="rounded-lg border border-line px-3 py-3 text-sm text-ink-3">
      Loading…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-3 py-3 text-[12px] text-ink-3">
      {children}
    </div>
  );
}
