"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAllModules } from "@/modules/registry";
import { LoadingState } from "@/components/states";

function WhoAmIPanel() {
  const whoAmI = useQuery(api.users.whoAmI);

  if (whoAmI === undefined) return <LoadingState />;
  if (whoAmI === null) return <div className="text-sm text-ink-3">Not signed in.</div>;

  if (!whoAmI.provisioned) {
    return (
      <pre className="mono text-xs bg-bg-2 p-3 rounded-md text-ink-2 overflow-auto">
{JSON.stringify(whoAmI.clerk, null, 2)}
      </pre>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-semibold text-ink">{whoAmI.user.displayName}</span>
        {whoAmI.user.email && <span className="text-ink-3">{whoAmI.user.email}</span>}
      </div>
      {whoAmI.actor === null ? (
        <div className="rounded-md border border-line bg-card-tint p-3">
          <div className="eyebrow mb-1">No actor</div>
          <p className="text-ink-2 text-xs">
            User row exists but has no workspace membership and no customer access yet.
          </p>
        </div>
      ) : whoAmI.actor.kind === "member" ? (
        <div className="rounded-md border border-line bg-card-tint p-3 space-y-1 text-xs">
          <div className="eyebrow">Member actor</div>
          <div><span className="text-ink-3">workspace</span>: <span className="mono">{whoAmI.actor.workspaceId}</span></div>
          <div><span className="text-ink-3">role</span>: <span className="pill pill--neutral">{whoAmI.actor.role}</span></div>
          <div><span className="text-ink-3">scope</span>: <span className="pill pill--neutral">{whoAmI.actor.scope}</span></div>
        </div>
      ) : (
        <div className="rounded-md border border-line bg-card-tint p-3 space-y-1 text-xs">
          <div className="eyebrow">Client actor</div>
          <div><span className="text-ink-3">customers</span>: <span className="num">{whoAmI.actor.customerCount}</span></div>
        </div>
      )}
    </div>
  );
}

export default function DebugPage() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10 space-y-10">
      <div>
        <div className="eyebrow">Debug</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
          Phase 0 smoke tests
        </h1>
        <p className="mt-2 text-ink-2 max-w-xl">
          A grab-bag of probes for the foundation: auth resolution, design tokens,
          and the module registry. These will move or disappear as the real app shell
          fills out.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auth chain</CardTitle>
          <CardDescription>Clerk identity → Convex auth → user record.</CardDescription>
        </CardHeader>
        <CardContent>
          <WhoAmIPanel />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="eyebrow">Module registry</div>
        {getAllModules().map((m) => (
          <Card key={m.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {m.name}
                {m.isBuiltIn && <span className="pill pill--neutral">built-in</span>}
              </CardTitle>
              {m.description && <CardDescription>{m.description}</CardDescription>}
            </CardHeader>
            {m.taskTypes && (
              <CardContent className="pt-0">
                <div className="eyebrow mb-2">Task types</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(m.taskTypes).map(([key, def]) => (
                    <div
                      key={key}
                      className="rounded-md border border-line bg-card-tint px-3 py-1.5 text-xs"
                    >
                      <div className="font-semibold text-ink">{def.label}</div>
                      <div className="mono text-ink-3">{key}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div className="eyebrow">Brand palette</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Navy", className: "bg-fmu-navy text-white", hex: "#092448" },
            { label: "Green", className: "bg-fmu-green text-white", hex: "#1c764d" },
            { label: "Yellow", className: "bg-fmu-yellow text-ink", hex: "#ffbb00" },
            { label: "Red", className: "bg-fmu-red text-white", hex: "#df0a28" },
            { label: "Cream", className: "bg-background text-ink border border-line-2", hex: "#f6f5f1" },
            { label: "Card", className: "bg-card text-ink border border-line", hex: "#ffffff" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg p-4 ${c.className}`}>
              <div className="text-sm font-semibold">{c.label}</div>
              <div className="num text-xs opacity-80">{c.hex}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="eyebrow">Status pills</div>
        <div className="flex flex-wrap gap-2">
          <span className="pill pill--draft">draft</span>
          <span className="pill pill--blocked">blocked</span>
          <span className="pill pill--review">review</span>
          <span className="pill pill--processing">processing</span>
          <span className="pill pill--completed">completed</span>
          <span className="pill pill--filed">filed</span>
          <span className="pill pill--failed">failed</span>
          <span className="pill pill--neutral">neutral</span>
        </div>
      </section>
    </div>
  );
}
