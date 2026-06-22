"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
  UserPlus,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { ClientAccessDialog } from "@/components/customers/client-access-dialog";
import { NewEventDialog } from "@/components/calendar/new-event-dialog";
import {
  CalendarView,
  useCalendarMode,
} from "@/components/calendar/calendar-view";
import { CustomerChatPanel } from "@/components/chat/customer-chat-panel";
import { LoadingState } from "@/components/states";
import { PageShell } from "@/components/layout/page-shell";
import { CustomerHeader } from "@/components/customers/customer-header";

export default function CustomerHomePage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;
  const customer = useQuery(api.customers.get, { customerId });

  if (customer === undefined) {
    return <LoadingState className="w-full px-8 py-8" />;
  }
  if (customer === null) {
    return (
      <div className="w-full px-8 py-8 text-sm text-ink-3">
        Customer not found.
      </div>
    );
  }
  return <CustomerHome customer={customer} />;
}

function CustomerHome({ customer }: { customer: Doc<"customers"> }) {
  const router = useRouter();
  const customerId = customer._id;

  const archiveCustomer = useMutation(api.customers.archive);
  const unarchiveCustomer = useMutation(api.customers.unarchive);

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  const [mode, setMode] = useCalendarMode("month");
  const [cursor, setCursor] = useState<number>(() => Date.now());

  const items = useQuery(api.calendar.upcomingForCustomer, {
    customerId,
    days: 120,
  });

  const archived = customer.archived === true;
  const metaChips = buildMetaChips(customer.metadata);

  return (
    <PageShell>
      <CustomerHeader
        customerId={customerId}
        meta={
          metaChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
              {metaChips.map((c, i) => (
                <span key={c.label} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-ink-4">·</span>}
                  <span className="eyebrow" style={{ letterSpacing: "0.08em" }}>
                    {c.label}
                  </span>
                  <span className={c.mono ? "num" : ""}>{c.value}</span>
                </span>
              ))}
            </div>
          ) : undefined
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Customer actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onSelect={() => setEditOpen(true)}
                disabled={archived}
              >
                <Pencil className="h-4 w-4" />
                Edit details
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setAccessOpen(true)}
                disabled={archived}
              >
                <UserPlus className="h-4 w-4" />
                Client access
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {archived ? (
                <DropdownMenuItem
                  onSelect={() => void unarchiveCustomer({ customerId })}
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => setArchiveOpen(true)}
                  className="text-fmu-red focus:text-fmu-red"
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="grid h-[calc(100vh-12rem)] min-h-[640px] gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="min-w-0">
          <CalendarView
            items={items}
            mode={mode}
            onModeChange={setMode}
            cursor={cursor}
            onCursorChange={setCursor}
            hideCustomerLabel
            onNewEvent={() => setNewEventOpen(true)}
          />
        </div>
        <CustomerChatPanel customerId={customerId} />
      </div>

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialValue={{
          id: customer._id,
          name: customer.name,
          metadata: customer.metadata,
        }}
      />

      <ClientAccessDialog
        open={accessOpen}
        onOpenChange={setAccessOpen}
        customerId={customerId}
        customerName={customer.name}
      />

      <NewEventDialog
        open={newEventOpen}
        onOpenChange={setNewEventOpen}
        fixedCustomerId={customerId}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {customer.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will be hidden from default lists. All of their
              documents, tasks, and history are preserved. You can unarchive
              them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await archiveCustomer({ customerId });
                setArchiveOpen(false);
                router.push("/customers");
              }}
              className="bg-fmu-red text-white hover:bg-fmu-red/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

type MetaChip = { label: string; value: string; mono?: boolean };

function buildMetaChips(meta: Doc<"customers">["metadata"]): MetaChip[] {
  if (!meta) return [];
  const out: MetaChip[] = [];
  if (meta.brn) out.push({ label: "BRN", value: meta.brn, mono: true });
  if (meta.vatRegistration)
    out.push({ label: "VAT", value: meta.vatRegistration, mono: true });
  if (meta.primaryContactEmail)
    out.push({ label: "Email", value: meta.primaryContactEmail });
  if (meta.primaryContactPhone)
    out.push({ label: "Phone", value: meta.primaryContactPhone, mono: true });
  return out;
}
