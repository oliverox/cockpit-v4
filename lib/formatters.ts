/**
 * Shared display formatters. Import from here rather than re-declaring these
 * in pages/components — they were previously copy-pasted across the app.
 */

/** "5 Jun 2026" — canonical absolute date used across lists & details. */
export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ts));
}

/** Relative due-date label: "today", "tomorrow", "in 5d", "3d ago", or a short
 * date once it's far enough out. */
export function formatDue(ts: number): string {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.round((ts - now) / day);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0 && days < 7) return `in ${days}d`;
  if (days < 0 && days > -30) return `${-days}d ago`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(ts));
}

/** Human file size: "820 B", "12 KB", "3.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** Initials mark from a name: "Ada Lovelace" → "AL", "RITOQUE" → "RI". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
