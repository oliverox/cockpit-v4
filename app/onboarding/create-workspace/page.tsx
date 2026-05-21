"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganizationList, useClerk } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { ArrowRight, PlaneTakeoff } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CreateWorkspacePage() {
  const router = useRouter();
  const { createOrganization, isLoaded: orgListLoaded } = useOrganizationList();
  const { setActive } = useClerk();
  const createWorkspace = useMutation(api.workspaces.create);

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    orgListLoaded &&
    createOrganization !== undefined &&
    name.trim().length > 0 &&
    !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const org = await createOrganization!({ name: name.trim() });
      await createWorkspace({ name: name.trim(), clerkOrgId: org.id });
      await setActive({ organization: org.id });
      router.push("/customers");
    } catch (err) {
      console.error("Workspace creation failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.15fr_1fr]">
      {/* LEFT PANE — atmosphere */}
      <aside className="relative hidden overflow-hidden border-r border-line lg:flex lg:items-center">
        <div className="ledger-bg absolute inset-0" aria-hidden />
        <PlaneTakeoff
          className="absolute -bottom-10 -right-12 h-80 w-80 rotate-[-14deg] text-fmu-navy/[0.045]"
          strokeWidth={1.25}
          aria-hidden
        />
        {/* Faint cross-fade so the ledger lines soften near the headline */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background via-background/40 to-transparent"
          aria-hidden
        />
        <div className="relative max-w-xl space-y-8 px-16 py-24">
          <div className="flex items-center gap-3">
            <div className="h-px w-10 bg-fmu-yellow" />
            <span className="eyebrow">Welcome to Cockpit</span>
          </div>
          <h1 className="font-[var(--font-serif)] text-[3.25rem] font-medium leading-[1.04] tracking-[-0.02em] text-fmu-navy">
            Make space for your work.
          </h1>
          <div className="max-w-md space-y-4">
            <p className="text-base leading-relaxed text-ink-2">
              A workspace is the home for everything you do for one firm —
              customers, documents, tasks, deadlines, conversations.
            </p>
            <p className="text-base leading-relaxed text-ink-2">
              You'll be its owner. Invite your team when you're ready.
            </p>
          </div>
        </div>
      </aside>

      {/* RIGHT PANE — form */}
      <section className="relative flex items-center justify-center bg-card px-6 py-24 lg:px-12">
        <div className="w-full max-w-sm space-y-10">
          <div className="space-y-4">
            <div className="eyebrow">Step 01</div>
            <h2 className="text-[2rem] font-semibold leading-[1.15] tracking-tight text-ink">
              Create your workspace
            </h2>
            <div className="h-[3px] w-10 bg-fmu-yellow" />
            <p className="max-w-xs text-sm text-ink-3">
              Name your firm. You can change this later.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="workspace-name"
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
              >
                Workspace name
              </Label>
              <Input
                id="workspace-name"
                placeholder="Cosmo &amp; Associates"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                autoFocus
                maxLength={100}
                required
                className="h-12 text-base"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-fmu-red/25 bg-fmu-red/[0.04] px-3 py-2.5 text-sm text-fmu-red"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="xl"
              disabled={!canSubmit}
              className="group w-full"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current/70" />
                  Creating…
                </span>
              ) : (
                <>
                  Create workspace
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
