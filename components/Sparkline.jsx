"use client";
import { Tooltip } from "@heroui/react";
import { MIN_TREND_POINTS, sparkPath } from "@/libs/trends";
import { formatINR } from "@/libs/units";

/**
 * A price series at table-row scale: no axes, no labels, just shape.
 *
 * Deliberately refuses to draw below MIN_TREND_POINTS distinct days. A single
 * backfilled observation rendered as a line is a flat line, which reads as
 * "this price is stable" when it actually means "we have looked once".
 */
export default function Sparkline({
  points,
  stats,
  priceUnit,
  width = 96,
  height = 24,
}) {
  if (!points || points.length < MIN_TREND_POINTS) {
    const n = points?.length ?? 0;
    return (
      <Tooltip
        content={
          n === 0
            ? "No price history recorded yet"
            : "Only one observation so far — a trend needs at least two days"
        }
      >
        <span className="text-default-400 text-xs tabular-nums">
          {n === 0 ? "no history" : "1 obs"}
        </span>
      </Tooltip>
    );
  }

  const values = points.map((p) => p.price);
  const path = sparkPath(values, width, height, 3);
  const last = points[points.length - 1];
  const up = stats?.changePct != null && stats.changePct > 0;
  const flat = stats?.changePct != null && Math.abs(stats.changePct) < 0.5;

  // end-dot y, recomputed the same way sparkPath does so the marker sits on the line
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const endY = span === 0 ? height / 2 : 3 + (height - 6) - ((last.price - min) / span) * (height - 6);

  const summary =
    `${points.length} days, ${stats?.firstDay} to ${stats?.lastDay}. ` +
    `Ranged ${formatINR(stats?.min)}–${formatINR(stats?.max)} per ${priceUnit}. ` +
    `Latest ${formatINR(last.price)} (${last.source}).`;

  return (
    <Tooltip content={summary} className="max-w-64">
      <div className="viz flex items-center gap-2">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          className="overflow-visible"
        >
          <path
            d={path}
            fill="none"
            stroke="var(--viz-series-1)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={width} cy={endY} r="2.5" fill="var(--viz-series-1)" />
        </svg>
        {/* the number carries the direction too, so it never reads by color alone */}
        <span
          className={`text-xs tabular-nums ${
            flat ? "text-default-400" : up ? "text-danger" : "text-success"
          }`}
        >
          {flat ? "flat" : `${up ? "▲" : "▼"}${Math.abs(stats.changePct).toFixed(0)}%`}
        </span>
      </div>
    </Tooltip>
  );
}
