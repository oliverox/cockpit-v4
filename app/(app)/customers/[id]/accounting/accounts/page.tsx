"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Landmark } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isModuleActive } from "@/modules/registry";
import { PageShell } from "@/components/layout/page-shell";
import { CustomerHeader } from "@/components/customers/customer-header";
import { EmptyState, LoadingState } from "@/components/states";
import { ChartOfAccounts } from "@/components/accounting/chart-of-accounts";

export default function AccountingAccountsPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;
  const workspace = useQuery(api.workspaces.getActive);
  const customer = useQuery(api.customers.get, { customerId });

  // Gate the same way the nav tab does (workspace install AND per-customer
  // enablement), so a direct URL agrees with whether the tab is shown.
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
        <EmptyState icon={Landmark}>
          The Accounting module isn’t enabled for this firm. Turn it on in
          Settings → Modules.
        </EmptyState>
      ) : (
        <ChartOfAccounts customerId={customerId} />
      )}
    </PageShell>
  );
}
