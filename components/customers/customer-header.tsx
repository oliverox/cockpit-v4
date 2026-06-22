"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getActiveModules, getCustomerNavEntries } from "@/modules/registry";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerTabs } from "@/components/customers/customer-tabs";

/**
 * The one header shared by every per-customer page (home / documents / tasks /
 * chat): back-arrow → customer name → centered section tabs → optional
 * right-side action. The active section is conveyed by the tab highlight, not
 * by changing the title — that's what keeps the four pages identical.
 */
export function CustomerHeader({
  customerId,
  actions,
  meta,
  className,
}: {
  customerId: Id<"customers">;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  const customer = useQuery(api.customers.get, { customerId });
  const workspace = useQuery(api.workspaces.getActive);
  const archived = customer?.archived === true;

  // Module-contributed tabs appear once their module is installed for the
  // workspace (and not disabled for this customer). Computed client-side from
  // the registry — the manifests carry the nav icons, so nothing crosses the
  // Convex boundary.
  const moduleNav = getCustomerNavEntries(
    getActiveModules(
      workspace?.installedModules ?? [],
      customer?.enabledModules,
    ),
  );

  return (
    <PageHeader
      title={customer?.name ?? "Customer"}
      backHref="/customers"
      backLabel="All customers"
      center={<CustomerTabs customerId={customerId} moduleNav={moduleNav} />}
      badge={
        archived ? (
          <span className="pill pill--neutral">Archived</span>
        ) : undefined
      }
      meta={meta}
      actions={actions}
      className={className}
    />
  );
}
