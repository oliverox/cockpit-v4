/**
 * Bank-statement CSV parsing + line mapping. Pure data, no React or Convex —
 * shared by the bank-rec renderer (parses client-side after upload) and as the
 * shape the finalize handler reads from task.payload. Ported from cockpit-v3's
 * csv-parser with v4-specific line mapping.
 */

// ── CSV parsing (ported from v3 lib/csv-parser.ts) ──────────────────────

export function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}

function looksLikeHeader(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c.trim());
  if (nonEmpty.length === 0) return false;
  const dataLike = nonEmpty.filter((c) => {
    const stripped = c.replace(/[,$%]/g, "").trim();
    if (!isNaN(Number(stripped)) && stripped !== "") return true;
    if (!isNaN(Date.parse(c))) return true;
    return false;
  });
  return dataLike.length < nonEmpty.length / 2;
}

function isSummaryRow(cells: string[]): boolean {
  const first = cells[0]?.trim().toLowerCase() ?? "";
  // Specific phrases only — NOT a bare "balance", which would wrongly drop a
  // narration-first transaction like "Balance transfer to savings".
  return [
    "closing balance",
    "opening balance",
    "grand total",
    "sub total",
    "subtotal",
    "net total",
    "total ",
  ].some((p) => first.startsWith(p)) || first === "total";
}

export type ParseCsvResult = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseStatementCsv(text: string): ParseCsvResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) throw new Error("The file has no rows.");

  const firstRow = parseLine(lines[0]);
  const hasHeader = looksLikeHeader(firstRow);
  const rawHeaders = hasHeader
    ? firstRow
    : firstRow.map((_, i) => `Column ${i + 1}`);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const seen = new Set<string>();
  const keep: number[] = [];
  const headers: string[] = [];
  rawHeaders.forEach((h, i) => {
    if (!h.trim()) return;
    let name = h;
    while (seen.has(name)) name = `${name}_${i}`;
    seen.add(name);
    headers.push(name);
    keep.push(i);
  });

  const toObj = (row: string[]): Record<string, string> => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = row[keep[idx]] ?? ""));
    return obj;
  };

  const rows: Record<string, string>[] = [];
  for (const line of dataLines) {
    const cells = parseLine(line);
    if (!cells.some((c) => c.trim())) continue;
    if (isSummaryRow(cells)) continue;
    rows.push(toObj(cells));
  }
  if (rows.length === 0) throw new Error("No transaction rows found in the file.");
  return { headers, rows };
}

// ── Column mapping + value parsing ──────────────────────────────────────

export type ColumnMap = {
  date: string;
  description: string;
  /** Single signed-amount column … */
  amount?: string;
  /** … OR separate debit (out) / credit (in) columns. */
  debit?: string;
  credit?: string;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Build a UTC-noon timestamp from y / 1-12 month / 1-31 day, rejecting
 *  out-of-range or overflowed dates (e.g. Feb 30, month 13) by round-trip. */
function utcYmd(y: number, mo1: number, d: number): number | null {
  if (mo1 < 1 || mo1 > 12 || d < 1 || d > 31) return null;
  const ts = Date.UTC(y, mo1 - 1, d, 12);
  const dt = new Date(ts);
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo1 - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return ts;
}

/**
 * Parse a statement date to a UTC-noon timestamp, or null if unrecognized /
 * invalid. Only known formats are accepted (no Date.parse fallback — it is
 * timezone-dependent and would drift period buckets). Day-first for numeric
 * D/M/Y. Unrecognized dates return null so the row is surfaced as skipped
 * rather than silently shifted.
 */
export function parseStatementDate(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  let m: RegExpExecArray | null;
  // ISO: YYYY-MM-DD or YYYY/MM/DD
  if ((m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(t))) {
    return utcYmd(+m[1], +m[2], +m[3]);
  }
  // Day-first numeric: DD/MM/YYYY or DD-MM-YY
  if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t))) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return utcYmd(y, +m[2], +m[1]);
  }
  // DD-Mon-YY / "DD Month YYYY"
  if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})$/.exec(t))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo !== undefined) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return utcYmd(y, mo + 1, +m[1]);
    }
  }
  return null;
}

/**
 * Parse a money cell to a number. Handles thousands/decimal separators (US
 * '1,234.50' and EU '1.234,50'), (parenthecized) and DR/CR-suffixed negatives.
 */
export function parseAmount(s: string): number {
  let t = (s ?? "").trim();
  if (!t) return 0;
  let sign = 1;
  if (/^\(.*\)$/.test(t)) {
    sign = -1;
    t = t.slice(1, -1);
  }
  // "DR" marks a debit/outflow; "CR" an inflow. Apply before stripping letters.
  if (/(^|[\s\d])dr\b/i.test(t)) sign = -1;

  const raw = t.replace(/[^0-9.,-]/g, "");
  if (!raw || raw === "-") return 0;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    // Both present — the later separator is the decimal point.
    const decIsComma = lastComma > lastDot;
    normalized = decIsComma
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Only commas: 2 trailing digits → decimal comma; otherwise thousands.
    normalized =
      raw.length - lastComma - 1 === 2
        ? raw.slice(0, lastComma).replace(/,/g, "") + "." + raw.slice(lastComma + 1)
        : raw.replace(/,/g, "");
  } else {
    normalized = raw;
  }

  const n = parseFloat(normalized);
  if (isNaN(n)) return 0;
  return sign < 0 ? -Math.abs(n) : n;
}

/** Guess which columns are date/description/amount (or debit/credit) by name. */
export function guessColumnMap(headers: string[]): ColumnMap {
  const find = (kw: string[]) =>
    headers.find((h) => kw.some((k) => h.toLowerCase().includes(k)));
  const debit = find(["debit", "withdrawal", "money out", "paid out", "dr"]);
  const credit = find(["credit", "deposit", "money in", "paid in", "cr"]);
  return {
    date: find(["date"]) ?? headers[0] ?? "",
    description:
      find(["description", "narration", "details", "particulars", "transaction", "reference"]) ??
      headers[1] ??
      "",
    amount: debit && credit ? undefined : find(["amount", "value"]),
    debit: debit && credit ? debit : undefined,
    credit: debit && credit ? credit : undefined,
  };
}

export type StatementLine = {
  /** Unique per occurrence (row hash + index) — React key + line identity. */
  rowHash: string;
  date: number;
  description: string;
  /** Positive = money in (credit), negative = money out (debit). */
  signedAmount: number;
  /** The ledger account this line is categorized to (assigned in review). */
  accountCode?: string;
};

/** The accounting.bank_rec task's draft payload (opaque to core). */
export type BankRecPayload = {
  /** accounting_bank_accounts id (stringified — opaque in the payload). */
  bankAccountId?: string;
  statementFileHash?: string;
  periodStart?: number;
  periodEnd?: number;
  lines: StatementLine[];
};

/** djb2 string hash → short base36 string. */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type MapResult = {
  lines: StatementLine[];
  /** Rows dropped during mapping, with a reason (surfaced to the user). */
  skipped: { reason: string }[];
};

export function mapRowsToLines(
  rows: Record<string, string>[],
  map: ColumnMap,
): MapResult {
  const lines: StatementLine[] = [];
  const skipped: { reason: string }[] = [];
  rows.forEach((row, i) => {
    const date = parseStatementDate(row[map.date] ?? "");
    const description = (row[map.description] ?? "").trim();
    let signedAmount: number;
    if (map.amount) {
      signedAmount = parseAmount(row[map.amount]);
    } else {
      const out = Math.abs(parseAmount(row[map.debit ?? ""]));
      const inn = Math.abs(parseAmount(row[map.credit ?? ""]));
      signedAmount = inn - out;
    }
    if (date === null) {
      skipped.push({ reason: "unreadable date" });
      return;
    }
    if (signedAmount === 0) {
      skipped.push({ reason: "zero amount" });
      return;
    }
    lines.push({
      rowHash: `r${hashText(JSON.stringify(row))}_${i}`,
      date,
      description,
      signedAmount,
    });
  });
  return { lines, skipped };
}

/** Every line categorized + a bank account chosen — the client mirror of the
 *  server's post-time assertion. */
export function bankRecCoverage(lines: StatementLine[]): {
  total: number;
  categorized: number;
  ready: boolean;
} {
  const total = lines.length;
  const categorized = lines.filter((l) => !!l.accountCode).length;
  return { total, categorized, ready: total > 0 && categorized === total };
}
