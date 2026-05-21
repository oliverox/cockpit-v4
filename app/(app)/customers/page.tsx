"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";

export default function CustomersPage() {
  const customers = useQuery(api.customers.list, {});
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Customers
        </h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New customer
        </Button>
      </div>

      <CustomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {customers === undefined && (
        <div className="text-sm text-ink-3">Loading…</div>
      )}

      {customers !== undefined && customers.length === 0 && (
        <p className="text-sm text-ink-3">No customers yet.</p>
      )}

      {customers !== undefined && customers.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => (
            <Link key={c._id} href={`/customers/${c._id}`} prefetch={false}>
              <Card className="transition hover:border-line-2">
                <CardHeader>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  {c.metadata?.brn && (
                    <CardDescription className="mono text-xs">
                      BRN {c.metadata.brn}
                    </CardDescription>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
