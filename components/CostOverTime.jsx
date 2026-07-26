"use client";
import { Chip, Tooltip as HeroTooltip } from "@heroui/react";
import { useMemo, useRef, useState } from "react";
import { recipeCostSeries } from "@/libs/trends";
import { formatINR } from "@/libs/units";

// Drawn in viewBox units and scaled to the container, so one set of numbers
// describes the geometry at every width.
const W = 640;
const H = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 52 };

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

const shortDay = (d) => d.slice(5).replace("-", "/"); // "2026-07-26" -> "07/26"

/**
 * What this recipe would have cost on each day we have prices for.
 *
 * This is the chart the whole ingest pipeline exists to make possible — it is
 * only meaningful because prices are an append-only series rather than a value
 * that gets overwritten every morning. Each day prices every ingredient at its
 * most recent observation on or before that day; `coverage` says how much of
 * that day's cost was backed by a real reading rather than the current stored
 * price, which is what keeps a flat line honest.
 */
export default function CostOverTime({ lines, history, servings, overheadPct }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const historyByName = useMemo(() => {
    const out = {};
    for (const [name, h] of Object.entries(history || {})) out[name] = h.points;
    return out;
  }, [history]);

  const series = useMemo(
    () => recipeCostSeries(lines, historyByName, { servings, overheadPct }),
    [lines, historyByName, servings, overheadPct]
  );

  if (!series.enough) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-default-500 text-sm">
          Not enough price history to chart this recipe yet.
        </p>
        <p className="text-default-400 text-xs">
          {series.tracked.length === 0
            ? "None of these ingredients has two days of observations. History accumulates one reading per day from the price sync."
            : `Only ${series.tracked.length} ingredient(s) are tracked and they share fewer than two days of readings.`}
        </p>
      </div>
    );
  }

  const { points, tracked, untracked } = series;
  const values = points.map((p) => p.total);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // pad the domain so a nearly-flat line doesn't get amplified into a mountain
  const padY = Math.max((rawMax - rawMin) * 0.15, rawMax * 0.02, 0.5);
  const yMin = Math.max(0, rawMin - padY);
  const yMax = rawMax + padY;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xAt = (i) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const yAt = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.total)}`).join(" ");
  const area = `${path} L${xAt(points.length - 1)},${PAD.top + plotH} L${xAt(0)},${PAD.top + plotH} Z`;
  const ticks = niceTicks(yMin, yMax);
  // label the ends only; a number on every point is noise, not information
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  const first = points[0];
  const last = points[points.length - 1];
  const changePct = first.total > 0 ? ((last.total - first.total) / first.total) * 100 : 0;
  const worstCoverage = Math.min(...points.map((p) => p.coverage));

  const onMove = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - PAD.left) / plotW) * (points.length - 1));
    setHover(Math.min(Math.max(i, 0), points.length - 1));
  };

  return (
    <div className="viz flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-bold tabular-nums">{formatINR(last.total)}</span>
        <span
          className={`text-sm tabular-nums ${
            changePct > 0.5 ? "text-danger" : changePct < -0.5 ? "text-success" : "text-default-400"
          }`}
        >
          {Math.abs(changePct) < 0.5
            ? "flat"
            : `${changePct > 0 ? "▲" : "▼"}${Math.abs(changePct).toFixed(1)}% since ${shortDay(first.day)}`}
        </span>
      </div>

      {/* Below ~520px the viewBox would scale the axis labels down to a few
          pixels, so the chart scrolls in its own container rather than
          shrinking past legibility. The page itself never scrolls sideways. */}
      <div className="overflow-x-auto">
        <div className="relative min-w-[520px]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label={`Recipe cost from ${first.day} to ${last.day}, ${formatINR(first.total)} to ${formatINR(last.total)}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke="var(--viz-grid)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={yAt(t) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--viz-muted)"
              >
                {formatINR(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text
                key={p.day}
                x={xAt(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--viz-muted)"
              >
                {shortDay(p.day)}
              </text>
            ) : null
          )}

          <path d={area} fill="var(--viz-band)" />
          <path
            d={path}
            fill="none"
            stroke="var(--viz-series-1)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={xAt(hover)}
                x2={xAt(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--viz-axis)"
                strokeWidth="1"
              />
              {/* 2px surface ring so the marker separates from the line under it */}
              <circle cx={xAt(hover)} cy={yAt(points[hover].total)} r="5" fill="var(--viz-series-1)" stroke="#111527" strokeWidth="2" />
            </g>
          )}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-medium border border-default-200 bg-content1 px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(xAt(hover) / W) * 100}%`,
              transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})`,
            }}
          >
            <div className="text-default-400">{points[hover].day}</div>
            <div className="font-semibold tabular-nums">{formatINR(points[hover].total)} total</div>
            <div className="tabular-nums text-default-500">
              {formatINR(points[hover].perServing)} per serving
            </div>
            <div className="text-default-400">
              {(points[hover].coverage * 100).toFixed(0)}% from observed prices
            </div>
          </div>
        )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip size="sm" variant="flat">
          {tracked.length} of {tracked.length + untracked.length} ingredients tracked
        </Chip>
        {untracked.length > 0 && (
          <HeroTooltip
            content={`Held at their current price across the whole window: ${untracked.join(", ")}`}
            className="max-w-72"
          >
            <Chip size="sm" variant="flat" color="warning">
              {untracked.length} held flat
            </Chip>
          </HeroTooltip>
        )}
        {worstCoverage < 0.99 && (
          <Chip size="sm" variant="flat" color="warning">
            as low as {(worstCoverage * 100).toFixed(0)}% observed on some days
          </Chip>
        )}
      </div>
    </div>
  );
}
