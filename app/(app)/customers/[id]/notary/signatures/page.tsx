"use client";

import { useParams } from "next/navigation";
import { Stamp } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { PageShell } from "@/components/layout/page-shell";
import { CustomerHeader } from "@/components/customers/customer-header";
import { EmptyState } from "@/components/states";

/**
 * ⚠️ Phase-0 throwaway placeholder for the notary toggle-proof stub. Proves a
 * module route mounts under the customer shell when the module is enabled.
 * Delete with the rest of the notary stub when Accounting lands (Phase 1).
 */
export default function NotarySignaturesPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;

  return (
    <PageShell>
      <CustomerHeader customerId={customerId} />
      <EmptyState icon={Stamp}>
        Notary module stub — proves the toggle path. No functionality yet.
      </EmptyState>
    </PageShell>
  );
}
