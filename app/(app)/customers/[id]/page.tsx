"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function CustomerDashboardPage() {
  const params = useParams<{ id: string }>();
  const customer = useQuery(api.customers.get, {
    customerId: params.id as Id<"customers">,
  });

  if (customer === undefined) {
    return <div className="p-8 text-sm text-ink-3">Loading…</div>;
  }

  if (customer === null) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-ink-3">
        Customer not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="eyebrow">Customer</div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
        {customer.name}
      </h1>
    </div>
  );
}
