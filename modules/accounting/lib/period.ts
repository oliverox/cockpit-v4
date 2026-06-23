/**
 * Period helpers for accounting time-series. Pure data, no React or Convex —
 * safe to import from server (finalize, ledger queries) and client (charts).
 *
 * Buckets are UTC months so that the periodKey stamped at post time and the
 * window computed at query time always agree, regardless of where each runs.
 * `now` is always passed in (not read via Date.now()) so these stay pure.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** 'YYYY-MM' period key for a timestamp (UTC month bucket). */
export function toPeriodKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type MonthBucket = {
  periodKey: string;
  year: number;
  /** 1-12 */
  month: number;
  /** e.g. "Jan 26" */
  label: string;
};

/**
 * The last `months` month-buckets ending with the (UTC) month containing
 * `now`, oldest first. Used to zero-fill time series so empty months render.
 */
export function buildMonthBuckets(months: number, now: number): MonthBucket[] {
  const base = new Date(now);
  const buckets: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    buckets.push({
      periodKey: `${year}-${String(month).padStart(2, "0")}`,
      year,
      month,
      label: `${MONTHS[d.getUTCMonth()]} ${String(year).slice(2)}`,
    });
  }
  return buckets;
}

/** Start-of-month timestamp (UTC) for the first bucket in a `months` window. */
export function windowStart(months: number, now: number): number {
  const base = new Date(now);
  return Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - (months - 1), 1);
}

/** Start-of-month timestamp (UTC) of the month AFTER `now` — exclusive upper
 *  bound for a window ending in the current month. */
export function windowEnd(now: number): number {
  const base = new Date(now);
  return Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1);
}
