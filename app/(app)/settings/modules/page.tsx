"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function ModulesSettingsPage() {
  const modules = useQuery(api.modules.listAvailable, {});
  const installModule = useMutation(api.modules.installModule);
  const uninstallModule = useMutation(api.modules.uninstallModule);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, installed: boolean) {
    setError(null);
    setBusy(id);
    try {
      if (installed) await uninstallModule({ moduleId: id });
      else await installModule({ moduleId: id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update module");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell size="3xl" className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Modules"
        description="Turn industry modules on or off for this firm. Enabling a module adds its features — extra tabs, task types, and tools — across every customer."
        className="mb-0"
      />

      {error && (
        <div className="rounded-md border border-fmu-red/30 bg-fmu-red/5 px-3 py-2 text-[12px] text-fmu-red">
          {error}
        </div>
      )}

      {modules === undefined ? (
        <LoadingState />
      ) : modules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card-tint/40 px-3 py-3 text-[12px] text-ink-3">
          No installable modules yet.
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
          {modules.map((m) => (
            <li key={m.id} className="flex items-center gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{m.name}</span>
                  {m.installed && (
                    <span className="pill pill--completed text-[10px]">
                      Enabled
                    </span>
                  )}
                </div>
                {m.description && (
                  <div className="mt-0.5 text-xs text-ink-3">
                    {m.description}
                  </div>
                )}
              </div>
              <Button
                variant={m.installed ? "outline" : "default"}
                size="sm"
                disabled={busy === m.id}
                onClick={() => void toggle(m.id, m.installed)}
              >
                {busy === m.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : m.installed ? (
                  "Disable"
                ) : (
                  "Enable"
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
