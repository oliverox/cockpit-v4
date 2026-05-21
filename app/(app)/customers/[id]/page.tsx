"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id as Id<"customers">;
  const customer = useQuery(api.customers.get, { customerId });

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

  return <CustomerDetail customer={customer} />;
}

function CustomerDetail({ customer }: { customer: Doc<"customers"> }) {
  const router = useRouter();
  const updateCustomer = useMutation(api.customers.update);
  const archiveCustomer = useMutation(api.customers.archive);
  const unarchiveCustomer = useMutation(api.customers.unarchive);

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const metaRows = useMetadataRows(customer.metadata);

  async function onArchive() {
    await archiveCustomer({ customerId: customer._id });
    setArchiveOpen(false);
  }
  async function onUnarchive() {
    await unarchiveCustomer({ customerId: customer._id });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-8 py-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="eyebrow">Customer</div>
            {customer.archived && (
              <span className="pill pill--neutral">Archived</span>
            )}
          </div>
          <InlineName
            value={customer.name}
            onSave={(name) =>
              updateCustomer({ customerId: customer._id, name })
            }
            disabled={customer.archived === true}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Customer actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onSelect={() => setEditOpen(true)}
              disabled={customer.archived === true}
            >
              <Pencil className="h-4 w-4" />
              Edit details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {customer.archived ? (
              <DropdownMenuItem onSelect={() => void onUnarchive()}>
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
      </div>

      {/* Metadata */}
      {metaRows.length > 0 && (
        <section className="rounded-lg border border-line bg-card">
          <div className="border-b border-line px-6 py-3">
            <div className="eyebrow">Details</div>
          </div>
          <dl className="divide-y divide-line">
            {metaRows.map(({ label, value, mono }) => (
              <div
                key={label}
                className="grid grid-cols-[160px_1fr] items-baseline gap-4 px-6 py-3"
              >
                <dt className="text-xs uppercase tracking-wider text-ink-3">
                  {label}
                </dt>
                <dd
                  className={cn(
                    "text-sm text-ink",
                    mono && "mono",
                  )}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialValue={{
          id: customer._id,
          name: customer.name,
          metadata: customer.metadata,
        }}
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
              onClick={onArchive}
              className="bg-fmu-red text-white hover:bg-fmu-red/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Helpers --------------------------------------------------------------

type MetaRow = { label: string; value: string; mono?: boolean };

function useMetadataRows(metadata: Doc<"customers">["metadata"]): MetaRow[] {
  if (!metadata) return [];
  const rows: MetaRow[] = [];
  if (metadata.brn) rows.push({ label: "BRN", value: metadata.brn, mono: true });
  if (metadata.vatRegistration)
    rows.push({ label: "VAT", value: metadata.vatRegistration, mono: true });
  if (metadata.primaryContactEmail)
    rows.push({ label: "Contact email", value: metadata.primaryContactEmail });
  if (metadata.primaryContactPhone)
    rows.push({
      label: "Contact phone",
      value: metadata.primaryContactPhone,
      mono: true,
    });
  if (metadata.timezone)
    rows.push({ label: "Timezone", value: metadata.timezone });
  return rows;
}

/**
 * Inline-editable headline. Click to edit; Enter to save, Escape to cancel.
 * No save button — blur or Enter commits.
 */
function InlineName({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (name: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      console.error(err);
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        autoFocus
        disabled={saving}
        maxLength={200}
        className="h-auto rounded-md border-line-2 px-3 py-1 text-3xl font-semibold tracking-tight text-ink"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={cn(
        "group -mx-3 -my-1 inline-flex max-w-full items-center gap-2 truncate rounded-md px-3 py-1 text-left text-3xl font-semibold tracking-tight text-ink",
        !disabled && "hover:bg-card-tint",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <span className="truncate">{value}</span>
      {!disabled && (
        <Pencil className="h-4 w-4 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
