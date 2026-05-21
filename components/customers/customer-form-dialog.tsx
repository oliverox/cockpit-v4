"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Metadata = {
  brn?: string;
  vatRegistration?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
};

type InitialValue = {
  id: Id<"customers">;
  name: string;
  metadata?: Metadata;
};

type CustomerFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog opens in edit mode with these defaults. */
  initialValue?: InitialValue;
  /** Optional callback fired after a successful create (receives the new id). */
  onCreated?: (customerId: Id<"customers">) => void;
};

/**
 * Single dialog that handles both creating a new customer and editing an
 * existing one. The form is identical; only the title, primary button
 * label, and the mutation called differ.
 */
export function CustomerFormDialog({
  open,
  onOpenChange,
  initialValue,
  onCreated,
}: CustomerFormDialogProps) {
  const router = useRouter();
  const createCustomer = useMutation(api.customers.create);
  const updateCustomer = useMutation(api.customers.update);

  const isEdit = initialValue !== undefined;

  const [name, setName] = useState(initialValue?.name ?? "");
  const [brn, setBrn] = useState(initialValue?.metadata?.brn ?? "");
  const [vat, setVat] = useState(
    initialValue?.metadata?.vatRegistration ?? "",
  );
  const [email, setEmail] = useState(
    initialValue?.metadata?.primaryContactEmail ?? "",
  );
  const [phone, setPhone] = useState(
    initialValue?.metadata?.primaryContactPhone ?? "",
  );
  const initialHasMetadata = Boolean(
    initialValue?.metadata &&
      Object.values(initialValue.metadata).some(Boolean),
  );
  const [showDetails, setShowDetails] = useState(initialHasMetadata);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed state when the dialog opens (or initialValue changes).
  useEffect(() => {
    if (!open) return;
    setName(initialValue?.name ?? "");
    setBrn(initialValue?.metadata?.brn ?? "");
    setVat(initialValue?.metadata?.vatRegistration ?? "");
    setEmail(initialValue?.metadata?.primaryContactEmail ?? "");
    setPhone(initialValue?.metadata?.primaryContactPhone ?? "");
    setShowDetails(
      Boolean(
        initialValue?.metadata &&
          Object.values(initialValue.metadata).some(Boolean),
      ),
    );
    setSubmitting(false);
    setError(null);
  }, [open, initialValue]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    const metadataParts: Metadata = {
      brn: brn.trim() || undefined,
      vatRegistration: vat.trim() || undefined,
      primaryContactEmail: email.trim() || undefined,
      primaryContactPhone: phone.trim() || undefined,
    };
    const hasMetadata = Object.values(metadataParts).some(Boolean);

    try {
      if (isEdit && initialValue) {
        await updateCustomer({
          customerId: initialValue.id,
          name: name.trim(),
          metadata: hasMetadata ? metadataParts : undefined,
        });
        onOpenChange(false);
      } else {
        const id = await createCustomer({
          name: name.trim(),
          metadata: hasMetadata ? metadataParts : undefined,
        });
        onCreated?.(id);
        onOpenChange(false);
        router.push(`/customers/${id}`);
      }
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Something went wrong.",
      );
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <form onSubmit={onSubmit}>
          <DialogHeader className="space-y-3 border-b border-line px-7 pt-7 pb-5">
            <div className="space-y-1.5">
              <DialogTitle className="text-2xl font-semibold tracking-tight text-ink">
                {isEdit ? "Edit customer" : "New customer"}
              </DialogTitle>
              <DialogDescription className="text-sm text-ink-3">
                {isEdit
                  ? "Update this customer's name and contact details."
                  : "Add a client to your workspace."}
              </DialogDescription>
            </div>
            <div className="h-[3px] w-8 bg-fmu-yellow" aria-hidden />
          </DialogHeader>

          <div className="space-y-5 px-7 py-6">
            <div className="space-y-2">
              <Label
                htmlFor="customer-name"
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3"
              >
                Name
              </Label>
              <Input
                id="customer-name"
                placeholder="ABC Trading Ltd"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                autoFocus
                maxLength={200}
                required
                className="h-12 text-base"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="-mx-1.5 -my-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-ink-2 transition-colors hover:text-ink"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  showDetails && "rotate-180",
                )}
              />
              <span>{showDetails ? "Hide details" : "Add details"}</span>
              <span className="text-ink-4">— BRN, VAT, contact info</span>
            </button>

            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-out",
                showDetails ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-md border border-line bg-card-tint p-4">
                  <DetailField
                    id="customer-brn"
                    label="BRN"
                    placeholder="C12345678"
                    value={brn}
                    onChange={setBrn}
                    disabled={submitting}
                  />
                  <DetailField
                    id="customer-vat"
                    label="VAT"
                    placeholder="VAT20001234"
                    value={vat}
                    onChange={setVat}
                    disabled={submitting}
                  />
                  <DetailField
                    id="customer-email"
                    label="Contact email"
                    placeholder="info@abctrading.mu"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    disabled={submitting}
                  />
                  <DetailField
                    id="customer-phone"
                    label="Contact phone"
                    placeholder="+230 5 123 4567"
                    type="tel"
                    value={phone}
                    onChange={setPhone}
                    disabled={submitting}
                  />
                </div>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-fmu-red/25 bg-fmu-red/[0.04] px-3 py-2.5 text-sm text-fmu-red"
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-line bg-card-tint/40 px-7 py-4">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="xl"
              disabled={!canSubmit}
              className="group min-w-[170px]"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current/70" />
                  {isEdit ? "Saving…" : "Creating…"}
                </span>
              ) : (
                <>
                  {isEdit ? "Save changes" : "Create customer"}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({
  id,
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  disabled,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3"
      >
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 bg-card"
      />
    </div>
  );
}
