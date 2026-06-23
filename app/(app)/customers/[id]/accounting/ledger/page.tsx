"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { BookOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isModuleActive } from "@/modules/registry";
import { PageShell } from "@/components/layout/page-shell";
import { CustomerHeader } from "@/components/customers/customer-header";
import { EmptyState, LoadingState } from "@/components/states";
import { LedgerWorkspace } from "@/components/accounting/ledger-workspace";

export default function AccountingLedgerPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;
  const workspace = useQuery(api.workspaces.getActive);
  const customer = useQuery(api.customers.get, { customerId });

  const loading = workspace === undefined || customer === undefined;
  const enabled = isModuleActive(
    workspace?.installedModules ?? [],
    customer?.enabledModules,
    "accounting",
  );

  return (
    <PageShell>
      <CustomerHeader customerId={customerId} />
      {loading ? (
        <LoadingState />
      ) : !enabled ? (
        <EmptyState icon={BookOpen}>
          The Accounting module isn’t enabled for this firm. Turn it on in
          Settings → Modules.
        </EmptyState>
      ) : (
        <LedgerWorkspace customerId={customerId} />
      )}
    </PageShell>
  );
}
