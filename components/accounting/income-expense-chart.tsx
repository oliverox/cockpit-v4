"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/formatters";

export type IncomeExpensePoint = {
  periodKey: string;
  label: string;
  revenue: number;
  expense: number;
  netIncome: number;
};

/** Compact money for axis ticks: 1.2M / 12k / 340. */
function shortMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

/**
 * Income-vs-expense (P&L) over time — hand-rolled inline SVG (no chart
 * dependency). Grouped revenue/expense bars + a net-income line, with an
 * accessible hover readout. Reads design tokens directly so it matches the
 * rest of the app.
 */
export function IncomeExpenseChart({ data }: { data: IncomeExpensePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;
  const H = 260;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allZero = data.every(
    (d) => d.revenue === 0 && d.expense === 0 && d.netIncome === 0,
  );
  if (data.length === 0 || allZero) {
    return (
      <div className="flex h-52 items-center justify-center rounded-xl border border-dashed border-line-2 bg-card-tint/40 text-sm text-ink-3">
        No posted transactions in this period yet.
      </div>
    );
  }

  const yMax = Math.max(
    1,
    ...data.map((d) => Math.max(d.revenue, d.expense, d.netIncome)),
  );
  const yMin = Math.min(0, ...data.map((d) => d.netIncome));
  const range = yMax - yMin || 1;
  const y = (v: number) => padT + plotH * (1 - (v - yMin) / range);
  const y0 = y(0);

  const n = data.length;
  const group = plotW / n;
  const barW = Math.min(16, group * 0.3);
  const gap = 3;
  const cx = (i: number) => padL + group * i + group / 2;

  const ticks = Array.from(new Set([yMax, (yMin + yMax) / 2, yMin]));
  const netPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${cx(i)},${y(d.netIncome)}`)
    .join(" ");

  const totRev = data.reduce((s, d) => s + d.revenue, 0);
  const totExp = data.reduce((s, d) => s + d.expense, 0);
  const summary = `Income versus expense over ${data.length} months. Total revenue ${formatAmount(
    totRev,
  )}, total expense ${formatAmount(totExp)}, net ${formatAmount(totRev - totExp)}.`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-fmu-green" />
          Revenue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-fmu-red" />
          Expense
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-fmu-navy" />
          Net income
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={summary}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y(t) + 3}
              textAnchor="end"
              fill="var(--ink-4)"
              fontSize={9}
            >
              {shortMoney(t)}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          x2={W - padR}
          y1={y0}
          y2={y0}
          stroke="var(--line-2)"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const gx = cx(i);
          return (
            <g
              key={d.periodKey}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              <rect
                x={gx - barW - gap / 2}
                y={y(Math.max(0, d.revenue))}
                width={barW}
                height={Math.abs(y0 - y(Math.max(0, d.revenue)))}
                fill="var(--fmu-green)"
                rx={1}
              />
              <rect
                x={gx + gap / 2}
                y={y(Math.max(0, d.expense))}
                width={barW}
                height={Math.abs(y0 - y(Math.max(0, d.expense)))}
                fill="var(--fmu-red)"
                rx={1}
              />
              <text
                x={gx}
                y={H - 10}
                textAnchor="middle"
                fill="var(--ink-3)"
                fontSize={9}
              >
                {d.label}
              </text>
              <rect
                x={padL + group * i}
                y={padT}
                width={group}
                height={plotH}
                fill="transparent"
              >
                <title>{`${d.label} — Revenue ${formatAmount(d.revenue)} · Expense ${formatAmount(d.expense)} · Net ${formatAmount(d.netIncome)}`}</title>
              </rect>
            </g>
          );
        })}

        <path
          d={netPath}
          fill="none"
          stroke="var(--fmu-navy)"
          strokeWidth={1.5}
        />
        {data.map((d, i) => (
          <circle
            key={d.periodKey}
            cx={cx(i)}
            cy={y(d.netIncome)}
            r={2}
            fill="var(--fmu-navy)"
          />
        ))}
      </svg>

      {hover !== null && data[hover] && (
        <div className="text-[11px] text-ink-2">
          <span className="font-medium">{data[hover].label}</span> · Revenue{" "}
          <span className="num">{formatAmount(data[hover].revenue)}</span> ·
          Expense <span className="num">{formatAmount(data[hover].expense)}</span>{" "}
          · Net{" "}
          <span
            className={cn(
              "num",
              data[hover].netIncome >= 0 ? "text-fmu-green" : "text-fmu-red",
            )}
          >
            {formatAmount(data[hover].netIncome)}
          </span>
        </div>
      )}
    </div>
  );
}
