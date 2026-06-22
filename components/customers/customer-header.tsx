"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  const archived = customer?.archived === true;

  return (
    <PageHeader
      title={customer?.name ?? "Customer"}
      backHref="/customers"
      backLabel="All customers"
      center={<CustomerTabs customerId={customerId} />}
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
