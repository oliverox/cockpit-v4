"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LoadingState } from "@/components/states";
import { formatAmount } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

type NewAccount = { code: string; name: string; type: string; parentCode: string };

/**
 * Chart of Accounts management — the Accounting module's first surface.
 * Ported from cockpit-v3's accounts table; inline-edit cells, opening-balance
 * columns, imbalance detection, plus a one-click "load default chart".
 */
export function ChartOfAccounts({
  customerId,
}: {
  customerId: Id<"customers">;
}) {
  const accounts = useQuery(api.modules.accounting.accounts.listAccounts, {
    customerId,
  });
  const openingBalances = useQuery(
    api.modules.accounting.accounts.getOpeningBalances,
    { customerId },
  );

  const createAccount = useMutation(
    api.modules.accounting.accounts.createAccount,
  );
  const updateAccount = useMutation(
    api.modules.accounting.accounts.updateAccount,
  );
  const upsertOpeningBalance = useMutation(
    api.modules.accounting.accounts.upsertOpeningBalance,
  );
  const importDefaultCoa = useMutation(
    api.modules.accounting.accounts.importDefaultCoa,
  );

  const [editingCell, setEditingCell] = useState<{
    accountId: string;
    field: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newAccount, setNewAccount] = useState<NewAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (accounts === undefined || openingBalances === undefined) {
    return <LoadingState />;
  }

  const startEdit = (accountId: string, field: string, current: string) => {
    setEditingCell({ accountId, field });
    setEditValue(current);
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    setError(null);
    try {
      if (
        editingCell.field === "openingDebit" ||
        editingCell.field === "openingCredit"
      ) {
        const account = accounts.find((a) => a._id === editingCell.accountId);
        if (!account) return;
        const ob = openingBalances[account.code] ?? { debit: 0, credit: 0 };
        const val = parseFloat(editValue) || 0;
        await upsertOpeningBalance({
          customerId,
          accountCode: account.code,
          debit: editingCell.field === "openingDebit" ? val : ob.debit,
          credit: editingCell.field === "openingCredit" ? val : ob.credit,
        });
      } else {
        await updateAccount({
          accountId: editingCell.accountId as Id<"accounting_accounts">,
          ...(editingCell.field === "name" ? { name: editValue } : {}),
          ...(editingCell.field === "type"
            ? { type: editValue as AccountType }
            : {}),
          ...(editingCell.field === "parentCode"
            ? { parentCode: editValue }
            : {}),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setEditingCell(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void saveEdit();
    if (e.key === "Escape") {
      setEditingCell(null);
      setEditValue("");
    }
  };

  const handleAddAccount = async () => {
    if (!newAccount || !newAccount.code || !newAccount.name || !newAccount.type)
      return;
    setError(null);
    try {
      await createAccount({
        customerId,
        code: newAccount.code,
        name: newAccount.name,
        type: newAccount.type as AccountType,
        parentCode: newAccount.parentCode || undefined,
      });
      setNewAccount(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async () => {
    setError(null);
    setImporting(true);
    try {
      await importDefaultCoa({ customerId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  // ── Summary ──
  const typeTotals: Record<string, number> = {};
  let totalObDebit = 0;
  let totalObCredit = 0;
  for (const a of accounts) {
    typeTotals[a.type] = (typeTotals[a.type] || 0) + 1;
    const ob = openingBalances[a.code];
    if (ob) {
      totalObDebit += ob.debit;
      totalObCredit += ob.credit;
    }
  }
  const imbalance = Math.abs(totalObDebit - totalObCredit);

  const renderEditableCell = (
    accountId: string,
    field: string,
    value: string,
    className?: string,
    displayValue?: string,
  ) => {
    const isEditing =
      editingCell?.accountId === accountId && editingCell?.field === field;

    if (isEditing) {
      if (field === "type") {
        return (
          <select
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => void saveEdit()}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        );
      }
      return (
        <input
          type={field.startsWith("opening") ? "number" : "text"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => void saveEdit()}
          onKeyDown={handleKeyDown}
          autoFocus
          step={field.startsWith("opening") ? "0.01" : undefined}
          className={cn(
            "w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy",
            field.startsWith("opening") && "text-right num",
          )}
        />
      );
    }

    const shown = displayValue ?? value;
    return (
      <button
        type="button"
        onClick={() => startEdit(accountId, field, value)}
        className={cn(
          "block w-full cursor-pointer rounded px-2 py-1 text-left transition-colors hover:bg-card-tint",
          className,
        )}
      >
        {shown || <span className="text-ink-4">—</span>}
      </button>
    );
  };

  const emptyAndIdle = accounts.length === 0 && !newAccount;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="eyebrow">Chart of accounts</div>
          <div className="text-xs text-ink-3">
            <span className="num">{accounts.length}</span> account
            {accounts.length !== 1 ? "s" : ""}
          </div>
        </div>
        {!emptyAndIdle && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setNewAccount({ code: "", name: "", type: "", parentCode: "" })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add account
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-fmu-red/30 bg-fmu-red/5 px-3 py-2 text-[12px] text-fmu-red">
          {error}
        </div>
      )}

      {emptyAndIdle ? (
        <div className="rounded-2xl border border-dashed border-line-2 bg-card-tint/40 px-6 py-12 text-center">
          <p className="text-sm text-ink-3">No chart of accounts yet.</p>
          <p className="mt-1 text-xs text-ink-4">
            Load the Mauritius default chart to get started, or add accounts
            manually.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button onClick={() => void handleImport()} disabled={importing}>
              {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Load default chart
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setNewAccount({ code: "", name: "", type: "", parentCode: "" })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add account
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-bg-2">
                <Th className="w-24">Code</Th>
                <Th>Name</Th>
                <Th className="w-28">Type</Th>
                <Th className="w-24">Parent</Th>
                <Th className="w-28 text-right">OB Debit</Th>
                <Th className="w-28 text-right">OB Credit</Th>
                <th className="w-10 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const ob = openingBalances[account.code] ?? {
                  debit: 0,
                  credit: 0,
                };
                const isPlaceholder = account.name === account.code;
                return (
                  <tr
                    key={account._id}
                    className="border-b border-line last:border-0 hover:bg-card-tint/40"
                  >
                    <td className="num px-4 py-1.5 text-ink-2">
                      {account.code}
                    </td>
                    <td className="px-2 py-1">
                      {renderEditableCell(
                        account._id,
                        "name",
                        account.name,
                        isPlaceholder ? "italic text-fmu-yellow" : "",
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {renderEditableCell(account._id, "type", account.type)}
                    </td>
                    <td className="px-2 py-1">
                      {renderEditableCell(
                        account._id,
                        "parentCode",
                        account.parentCode ?? "",
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {renderEditableCell(
                        account._id,
                        "openingDebit",
                        ob.debit > 0 ? String(ob.debit) : "",
                        "num text-right",
                        ob.debit > 0 ? formatAmount(ob.debit) : "",
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {renderEditableCell(
                        account._id,
                        "openingCredit",
                        ob.credit > 0 ? String(ob.credit) : "",
                        "num text-right",
                        ob.credit > 0 ? formatAmount(ob.credit) : "",
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <DeleteAccountButton
                        accountId={account._id}
                        code={account.code}
                        name={account.name}
                        onError={setError}
                      />
                    </td>
                  </tr>
                );
              })}

              {newAccount ? (
                <tr className="border-t border-line bg-fmu-green/[0.04]">
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={newAccount.code}
                      onChange={(e) =>
                        setNewAccount({ ...newAccount, code: e.target.value })
                      }
                      placeholder="Code"
                      autoFocus
                      className="num w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={newAccount.name}
                      onChange={(e) =>
                        setNewAccount({ ...newAccount, name: e.target.value })
                      }
                      placeholder="Account name"
                      className="w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={newAccount.type}
                      onChange={(e) =>
                        setNewAccount({ ...newAccount, type: e.target.value })
                      }
                      className="w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
                    >
                      <option value="">Select type</option>
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={newAccount.parentCode}
                      onChange={(e) =>
                        setNewAccount({
                          ...newAccount,
                          parentCode: e.target.value,
                        })
                      }
                      placeholder="Parent"
                      className="num w-full rounded border border-line bg-card px-2 py-1 text-xs outline-none focus:border-fmu-navy"
                    />
                  </td>
                  <td colSpan={2} className="px-3 py-1.5">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleAddAccount()}
                        disabled={
                          !newAccount.code ||
                          !newAccount.name ||
                          !newAccount.type
                        }
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setNewAccount(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </td>
                  <td />
                </tr>
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-2">
                    <button
                      onClick={() =>
                        setNewAccount({
                          code: "",
                          name: "",
                          type: "",
                          parentCode: "",
                        })
                      }
                      className="flex items-center gap-1.5 text-xs text-ink-4 transition-colors hover:text-ink-2"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add account
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!emptyAndIdle && (
        <div className="flex flex-wrap gap-4 text-xs text-ink-3">
          {Object.entries(typeTotals).map(([type, count]) => (
            <span key={type}>
              <span className="num">{count}</span> {type}
            </span>
          ))}
          <span className="ml-auto">
            OB Debit: <span className="num">{formatAmount(totalObDebit)}</span>
          </span>
          <span>
            OB Credit: <span className="num">{formatAmount(totalObCredit)}</span>
          </span>
          {imbalance > 0.01 && (
            <span className="font-medium text-fmu-yellow">
              Imbalance: <span className="num">{formatAmount(imbalance)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3",
        className,
      )}
    >
      {children}
    </th>
  );
}

function DeleteAccountButton({
  accountId,
  code,
  name,
  onError,
}: {
  accountId: Id<"accounting_accounts">;
  code: string;
  name: string;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const deleteAccount = useMutation(
    api.modules.accounting.accounts.deleteAccount,
  );

  const handleDelete = async () => {
    try {
      await deleteAccount({ accountId });
      setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          className="rounded p-1 text-ink-4 transition-colors hover:text-fmu-red"
          aria-label={`Delete account ${code}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete account {code}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes “{name}” and its opening balance. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-fmu-red hover:bg-fmu-red/90"
            onClick={() => void handleDelete()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
