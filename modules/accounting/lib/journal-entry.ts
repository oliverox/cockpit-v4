/**
 * Journal-entry payload shape + balance helpers. Pure data, no React or Convex
 * — shared by the server post-to-ledger assertion (the authority) and the
 * client renderer (which mirrors it to enable/disable the post action).
 */

export type JournalLine = {
  accountCode: string;
  description?: string;
  debit: number;
  credit: number;
};

export type JournalEntryPayload = {
  /** Effective date of the entry (ms). Defaults to post time if absent. */
  date?: number;
  memo?: string;
  reference?: string;
  lines: JournalLine[];
};

/** Round to 2 decimal places (money). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type JournalTotals = { debit: number; credit: number; balanced: boolean };

export function journalTotals(lines: JournalLine[]): JournalTotals {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += round2(l.debit || 0);
    credit += round2(l.credit || 0);
  }
  debit = round2(debit);
  credit = round2(credit);
  return { debit, credit, balanced: debit === credit && debit > 0 };
}

/** A line is valid if it names an account and is exactly one of debit/credit. */
export function lineIsValid(l: JournalLine): boolean {
  const d = l.debit || 0;
  const c = l.credit || 0;
  if (!l.accountCode) return false;
  if (d < 0 || c < 0) return false;
  if (d > 0 && c > 0) return false;
  if (d === 0 && c === 0) return false;
  return true;
}

/**
 * Postable = ≥2 lines, every line valid, and balanced. The server re-asserts
 * this at post time; this is the client mirror for the post button.
 */
export function isPostable(payload: JournalEntryPayload | undefined): boolean {
  const lines = payload?.lines ?? [];
  if (lines.length < 2) return false;
  if (!lines.every(lineIsValid)) return false;
  return journalTotals(lines).balanced;
}
