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

/** A statement line matched 1:1 to an existing unreconciled ledger entry
 *  (Phase 3b). Denormalized ledger fields are for display + audit snapshot. */
export type LineMatch = {
  rowHash: string;
  ledgerEntryId: string;
  matchType: "exact" | "manual";
  ledgerDate: number;
  ledgerDescription: string;
  ledgerAmount: number;
};

/** A candidate unreconciled ledger entry to match against. */
export type MatchCandidate = {
  _id: string;
  date: number;
  description: string;
  /** Signed bank effect (debit−credit): positive = inflow, negative = outflow. */
  signedAmount: number;
};

/**
 * One logical match between bank statement line(s) and ledger reference(s)
 * (supersedes the 1:1 LineMatch, supporting one-to-many / many-to-one splits).
 *  - `bankRowHashes`: the statement line(s) on the bank side.
 *  - `ledgerRefs`: Mode B → existing ledger entry `_id`s; Mode A → LedgerTxn ids.
 *  - `source`: how the group was formed; AI groups must still pass finalize's
 *    server-side balance assertions before any ledger entry is flipped.
 */
export type MatchGroup = {
  groupId: string;
  bankRowHashes: string[];
  ledgerRefs: string[];
  source: "exact" | "manual" | "ai";
  confidence?: "exact" | "probable";
  /** AI rationale (notes from the matching model), for display only. */
  reason?: string;
};

/**
 * A cashbook line uploaded as the ledger side in Mode A (`ledgerSource:
 * "cashbook"`). Lives only in task.payload until finalize imports it into the
 * double-entry ledger. `accountCode` is the category assigned in review; when
 * absent, the import posts it to SUSPENSE_CODE.
 */
export type LedgerTxn = {
  /** Stable id within the payload (used as a MatchGroup ledgerRef in Mode A). */
  id: string;
  date: number;
  description: string;
  /** Positive = money in, negative = money out (same convention as lines). */
  signedAmount: number;
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
  /** Legacy 1:1 matches (Phase 3b). Read through `lineMatchesToGroups` so
   *  finalize has a single match-group code path; new matches go in
   *  `matchGroups` below. */
  matches?: LineMatch[];
  /** Match groups (splits + AI), supersede `matches`. */
  matchGroups?: MatchGroup[];
  /** Which side the ledger comes from. "existing" = the Convex ledger (Mode B,
   *  default); "cashbook" = an uploaded ledger file (Mode A). */
  ledgerSource?: "existing" | "cashbook";
  /** Mode A posting behaviour. "import" (v3-faithful) posts the cashbook into
   *  the ledger; "report" posts nothing but explicitly-recorded items. */
  modeAVariant?: "import" | "report";
  /** Wizard cursor (the 4-step stepper). */
  step?: "bank" | "ledger" | "reconcile" | "report";
  /** Mode A: the uploaded cashbook side + its hash and balances. */
  ledgerTxns?: LedgerTxn[];
  cashbookFileHash?: string;
  cashbookOpening?: number;
  cashbookClosing?: number;
  /** Metadata from the last AI auto-match run (display + truncation warning). */
  aiMatch?: {
    ranAt: number;
    model: string;
    groupCount: number;
    unmatchedBank: number;
    unmatchedLedger: number;
    truncated?: boolean;
  };
  /** How the lines were ingested (Phase 3c). */
  sourceFormat?: "csv" | "pdf";
  /** Statement-level metadata captured during AI PDF extraction (Phase 3c).
   *  bankName/currency/period are informational; the balances feed the
   *  variance-to-zero reconciliation statement (Phase 3c-ii). */
  bankName?: string;
  statementCurrency?: string;
  periodLabel?: string;
  openingBalance?: number;
  closingBalance?: number;
  /** Reconciliation variance (expected − stated closing) at the moment of
   *  posting, and whether a non-zero variance was explicitly acknowledged
   *  (Phase 3c-ii audit trail). */
  varianceAtPost?: number;
  varianceAcknowledged?: boolean;
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

/** Every line resolved — categorized as new OR matched to an existing ledger
 *  entry. The client mirror of the server's post-time assertion. */
export function bankRecCoverage(
  lines: StatementLine[],
  matches: LineMatch[] = [],
): { total: number; resolved: number; ready: boolean } {
  const matched = new Set(matches.map((m) => m.rowHash));
  const total = lines.length;
  const resolved = lines.filter(
    (l) => !!l.accountCode || matched.has(l.rowHash),
  ).length;
  return { total, resolved, ready: total > 0 && resolved === total };
}

/**
 * Upgrade legacy 1:1 `LineMatch[]` payloads to singleton `MatchGroup[]`, so
 * finalize and the renderer have a single match-group code path. Pure; the
 * inverse is never needed (new matches are authored directly as MatchGroups).
 */
export function lineMatchesToGroups(matches: LineMatch[] = []): MatchGroup[] {
  return matches.map((m) => ({
    groupId: `g_${m.rowHash}`,
    bankRowHashes: [m.rowHash],
    ledgerRefs: [m.ledgerEntryId],
    source: m.matchType === "exact" ? "exact" : "manual",
  }));
}

/**
 * The effective match groups for a payload: legacy `matches` upgraded to
 * singletons, plus any `matchGroups`, de-duplicated by groupId (matchGroups
 * win). The single source of truth both the renderer and finalize read.
 */
export function effectiveMatchGroups(p: {
  matches?: LineMatch[];
  matchGroups?: MatchGroup[];
}): MatchGroup[] {
  const groups = lineMatchesToGroups(p.matches);
  const seen = new Set(groups.map((g) => g.groupId));
  for (const g of p.matchGroups ?? []) {
    if (!seen.has(g.groupId)) {
      seen.add(g.groupId);
      groups.push(g);
    }
  }
  return groups;
}

export type BankRecVariance = {
  /** Both opening and closing balances are known. */
  hasBalances: boolean;
  opening: number | null;
  closing: number | null;
  /** Positive sum of money-in lines. */
  inflows: number;
  /** Positive magnitude of money-out lines. */
  outflows: number;
  /** Net movement: inflows − outflows. */
  movement: number;
  /** opening + movement (null if no opening). */
  expectedClosing: number | null;
  /** expectedClosing − statedClosing (null unless both balances known). */
  variance: number | null;
  /** Reconciliation ties out (within tolerance). */
  tied: boolean;
};

/**
 * Statement self-consistency tie-out (Phase 3c-ii): does opening + the sum of
 * every line equal the stated closing balance? Sums ALL lines (matched and new
 * alike — the bank's total moved regardless of how each line is posted), so it
 * is independent of the finalize matched/new partition. Pure; validates that
 * the captured/extracted lines fully account for the statement's movement.
 */
export function bankRecVariance(
  lines: StatementLine[],
  opening?: number,
  closing?: number,
): BankRecVariance {
  // Sign-symmetric round to 2dp (round half away from zero, no negative zero).
  const r2 = (n: number) => {
    const r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
    return n < 0 && r !== 0 ? -r : r;
  };
  let inflows = 0;
  let outflows = 0;
  for (const l of lines) {
    if (l.signedAmount > 0) inflows += l.signedAmount;
    else outflows += -l.signedAmount;
  }
  inflows = r2(inflows);
  outflows = r2(outflows);
  const movement = r2(inflows - outflows);
  const op = typeof opening === "number" ? opening : null;
  const cl = typeof closing === "number" ? closing : null;
  const hasBalances = op !== null && cl !== null;
  const expectedClosing = op !== null ? r2(op + movement) : null;
  const variance =
    expectedClosing !== null && cl !== null ? r2(expectedClosing - cl) : null;
  const tied = hasBalances && variance !== null && Math.abs(variance) <= 0.02;
  return {
    hasBalances,
    opening: op,
    closing: cl,
    inflows,
    outflows,
    movement,
    expectedClosing,
    variance,
    tied,
  };
}

export type FixItem = {
  date: number;
  description: string;
  /** Signed adjustment to the ledger needed to close the variance. */
  amount: number;
  fixAction?: string;
};

export type ReconcileToZero = {
  /** The reconciling items, possibly with an appended rounding adjustment. */
  items: FixItem[];
  /** bankClosing − (ledgerClosing + Σ items) before any auto-correction. */
  residual: number;
  /** Whether the statement ties out after folding in the residual. */
  tied: boolean;
};

/**
 * Two-sided reconciliation tie-out (Mode A — bank statement vs cashbook),
 * ported from cockpit-v3. Given both stated closing balances and the signed
 * reconciling items (unmatched on either side, each signed as the ledger
 * adjustment needed), confirm bankClosing == ledgerClosing + Σ items; if a
 * residual remains (opening drift / cumulative rounding) fold it into an
 * existing rounding item or append one, so fixing all items reaches $0.00. Pure.
 */
export function reconcileToZero(
  bankClosing: number,
  ledgerClosing: number,
  items: FixItem[],
): ReconcileToZero {
  // Sign-symmetric round to 2dp (no negative zero).
  const round = (n: number) => {
    const r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
    return n < 0 && r !== 0 ? -r : r;
  };
  const sum = round(items.reduce((s, i) => s + i.amount, 0));
  const residual = round(bankClosing - (ledgerClosing + sum));
  if (Math.abs(residual) <= 0.005) return { items, residual: 0, tied: true };
  const rounding = items.find((i) =>
    /rounding|adjustment|discrepancy|residual/i.test(i.description),
  );
  const next = rounding
    ? items.map((i) =>
        i === rounding ? { ...i, amount: round(i.amount + residual) } : i,
      )
    : [
        ...items,
        {
          date: items[0]?.date ?? 0,
          description: "Rounding adjustment",
          amount: round(residual),
          fixAction:
            "Acknowledge: cumulative rounding difference across matched transactions",
        },
      ];
  return { items: next, residual, tied: true };
}

const MATCH_DAY = 24 * 60 * 60 * 1000;

/**
 * Deterministic exact-match suggestions: amount within 0.02 (sign-agnostic)
 * and date within 3 days, greedy 1:1 (each candidate used at most once),
 * best by date proximity then amount delta. No AI (that's Phase 3c).
 */
export function suggestExactMatches(
  lines: StatementLine[],
  candidates: MatchCandidate[],
): LineMatch[] {
  const used = new Set<string>();
  const out: LineMatch[] = [];
  for (const line of lines) {
    let best: MatchCandidate | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      if (used.has(c._id)) continue;
      // Signed comparison enforces amount AND direction together.
      const delta = Math.abs(c.signedAmount - line.signedAmount);
      if (delta > 0.02) continue;
      const dd = Math.abs(c.date - line.date);
      if (dd > 3 * MATCH_DAY) continue;
      const score = dd + delta * MATCH_DAY;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      used.add(best._id);
      out.push({
        rowHash: line.rowHash,
        ledgerEntryId: best._id,
        matchType: "exact",
        ledgerDate: best.date,
        ledgerDescription: best.description,
        ledgerAmount: best.signedAmount,
      });
    }
  }
  return out;
}

// ── AI PDF extraction (Phase 3c) ────────────────────────────────────────
// The model returns this shape (ported ~verbatim from cockpit-v3's
// reconciliationProcessor extraction prompt). Parsing + mapping are pure and
// shared with the Convex Node action that calls Anthropic, so they're testable
// without the network and reused if a CSV path ever wants the same mapping.

export type ExtractedTxn = {
  date: string;
  description: string;
  amount: number;
  type?: string;
  reference?: string;
};

export type ExtractedStatement = {
  openingBalance?: number;
  closingBalance?: number;
  currency?: string;
  period?: string;
  accountName?: string;
  bankName?: string;
  transactions: ExtractedTxn[];
};

function asNumberOrUndef(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseAmount(v);
    return n === 0 && !/\d/.test(v) ? undefined : n;
  }
  return undefined;
}

/** Coerce a parsed blob into ExtractedStatement, tolerating missing fields. */
function normalizeStatement(raw: unknown): ExtractedStatement {
  const o = (raw ?? {}) as Record<string, unknown>;
  const txns = Array.isArray(o.transactions) ? o.transactions : [];
  return {
    openingBalance: asNumberOrUndef(o.openingBalance),
    closingBalance: asNumberOrUndef(o.closingBalance),
    currency: typeof o.currency === "string" ? o.currency : undefined,
    period: typeof o.period === "string" ? o.period : undefined,
    accountName: typeof o.accountName === "string" ? o.accountName : undefined,
    bankName: typeof o.bankName === "string" ? o.bankName : undefined,
    transactions: txns as ExtractedTxn[],
  };
}

/**
 * Strip markdown fences, repair brace/bracket truncation, then JSON.parse —
 * mirrors cockpit-v3's extraction parsing so a `max_tokens`-truncated response
 * still yields the transactions captured so far. Throws if unrecoverable.
 */
function parseLenientJson(text: string): unknown {
  const raw = (text ?? "").trim();
  if (!raw) throw new Error("AI returned no text.");
  // The prompts forbid fences, so the common case is raw JSON — try it first,
  // then a line-based fence strip (safe even if a string value contains ```).
  const stripped = raw
    .replace(/^```(?:json)?[ \t]*\r?\n?/, "")
    .replace(/\r?\n?```[ \t]*$/, "")
    .trim();
  for (const c of stripped === raw ? [raw] : [raw, stripped]) {
    try {
      return JSON.parse(c);
    } catch {
      /* fall through to repair */
    }
  }
  // Truncation repair for a max_tokens cut — string-literal-aware so a literal
  // '}' or ']' inside a description never confuses the cut point or the count.
  return JSON.parse(repairTruncatedJson(stripped));
}

export function parseExtractionJson(text: string): ExtractedStatement {
  return normalizeStatement(parseLenientJson(text));
}

/**
 * Close JSON truncated mid-stream: scan honoring string literals + escapes,
 * find the last structural '}' / ']', cut there, and append the brackets still
 * open at that point (innermost first). Throws if there's no complete value.
 */
function repairTruncatedJson(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: ("{" | "[")[] = [];
  let cut = -1;
  let remaining: ("{" | "[")[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
      cut = i;
      remaining = [...stack];
    } else if (ch === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
      cut = i;
      remaining = [...stack];
    }
  }
  if (cut === -1) throw new Error("AI returned no usable JSON.");
  let out = s.slice(0, cut + 1);
  for (let i = remaining.length - 1; i >= 0; i--) {
    out += remaining[i] === "{" ? "}" : "]";
  }
  return out;
}

/**
 * Map an extracted statement to v4 StatementLine[]. Dates parsed UTC-deterministic
 * (reuses parseStatementDate — the model is told to emit YYYY-MM-DD); amount is a
 * single signed number (negative = outflow). Unreadable-date / zero-amount rows
 * are surfaced as skipped, never silently dropped.
 */
export function mapExtractedToLines(stmt: ExtractedStatement): MapResult {
  const lines: StatementLine[] = [];
  const skipped: { reason: string }[] = [];
  (stmt.transactions ?? []).forEach((t, i) => {
    const date = parseStatementDate(String(t?.date ?? ""));
    const amount = asNumberOrUndef(t?.amount) ?? 0;
    const base = String(t?.description ?? "").trim() || String(t?.type ?? "").trim();
    const ref = String(t?.reference ?? "").trim();
    const description = ref ? `${base} (ref ${ref})` : base;
    if (date === null) {
      skipped.push({ reason: "unreadable date" });
      return;
    }
    if (amount === 0) {
      skipped.push({ reason: "zero amount" });
      return;
    }
    lines.push({
      rowHash: `x${hashText(JSON.stringify(t))}_${i}`,
      date,
      description,
      signedAmount: amount,
    });
  });
  return { lines, skipped };
}

// ── AI matching (Phase 3d) ──────────────────────────────────────────────
// The Opus matching action (convex/modules/accounting/match.ts) sends the
// unmatched bank lines + ledger candidates (each with a stable `id`) and gets
// back proposed matches keyed by those ids. Parsing is pure + shared so it's
// testable without the network; every id/amount the model returns is
// re-validated server-side before any ledger entry is touched.

/** One proposed match the model returns (ids reference the inputs we sent). */
export type AiMatchProposal = {
  bankIds: string[];
  ledgerIds: string[];
  confidence?: "exact" | "probable";
  notes?: string;
};

export type AiMatchResult = {
  matches: AiMatchProposal[];
  unmatchedBankIds: string[];
  unmatchedLedgerIds: string[];
  errors: string[];
};

function asStringArray(x: unknown): string[] {
  return Array.isArray(x)
    ? x.map((v) => String(v)).filter((s) => s.length > 0)
    : [];
}

function normalizeMatchResult(raw: unknown): AiMatchResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const matches = Array.isArray(o.matches) ? o.matches : [];
  return {
    matches: matches.map((m) => {
      const mm = (m ?? {}) as Record<string, unknown>;
      const conf = mm.confidence;
      return {
        bankIds: asStringArray(mm.bankIds),
        ledgerIds: asStringArray(mm.ledgerIds),
        confidence:
          conf === "exact" ? "exact" : conf === "probable" ? "probable" : undefined,
        notes: typeof mm.notes === "string" ? mm.notes : undefined,
      };
    }),
    unmatchedBankIds: asStringArray(o.unmatchedBankIds),
    unmatchedLedgerIds: asStringArray(o.unmatchedLedgerIds),
    errors: asStringArray(o.errors),
  };
}

/**
 * Parse the matching model's JSON (fence-strip + truncation-repair shared with
 * extraction), tolerating missing fields. Pure; the caller re-validates every
 * id and amount against the inputs it sent.
 */
export function parseMatchJson(text: string): AiMatchResult {
  return normalizeMatchResult(parseLenientJson(text));
}
