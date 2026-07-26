"use client";
import { Button, Chip, Slider, Tooltip } from "@heroui/react";
import { useMemo, useState } from "react";
import { formatINR, recipeCost } from "@/libs/units";

/**
 * "What if prices move?" — bounded by what prices have actually done.
 *
 * The bounds are the point. An unbounded slider invites a made-up number; a
 * slider that stops at the observed floor and ceiling answers a question the
 * data can support: onion has traded between X and Y, so this recipe has cost
 * between A and B. Only ingredients with real history get a slider.
 *
 * Overrides are local and never saved — this is a scenario view, not an edit.
 */
export default function WhatIfPanel({ lines, history, servings, overheadPct, baseTotal }) {
  const [overrides, setOverrides] = useState({});

  const adjustable = useMemo(
    () =>
      (lines || [])
        .filter((l) => l.ingredientName?.trim())
        .map((l) => ({ line: l, stats: history?.[l.ingredientName]?.stats }))
        // a slider needs a range; one observation gives a floor equal to its ceiling
        .filter(({ stats }) => stats?.enough && stats.max > stats.min),
    [lines, history]
  );

  const scenarioLines = useMemo(
    () =>
      (lines || []).map((l) =>
        overrides[l.ingredientName] != null
          ? { ...l, price: overrides[l.ingredientName] }
          : l
      ),
    [lines, overrides]
  );

  const totals = useMemo(
    () =>
      recipeCost(
        scenarioLines.filter((l) => l.ingredientName?.trim()),
        { servings: Number(servings) || 1, overheadPct: Number(overheadPct) || 0 }
      ),
    [scenarioLines, servings, overheadPct]
  );

  if (adjustable.length === 0) {
    return (
      <p className="text-default-400 text-sm">
        No ingredient has moved across two or more observed days yet, so there is no
        observed range to slide within. This fills in as the daily sync accumulates readings.
      </p>
    );
  }

  const setAll = (pick) =>
    setOverrides(
      Object.fromEntries(adjustable.map(({ line, stats }) => [line.ingredientName, pick(stats)]))
    );

  const dirty = Object.keys(overrides).length > 0;
  const delta = totals.total - baseTotal;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="flat" onPress={() => setAll((s) => s.max)}>
          Every price at its peak
        </Button>
        <Button size="sm" variant="flat" onPress={() => setAll((s) => s.min)}>
          At its floor
        </Button>
        <Button size="sm" variant="light" isDisabled={!dirty} onPress={() => setOverrides({})}>
          Reset
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {adjustable.map(({ line, stats }) => {
          const value = overrides[line.ingredientName] ?? Number(line.price);
          // a stored price can sit outside the observed window (hand-entered, or
          // older than the 90-day lookback) — widen rather than clamp it away
          const min = Math.floor(Math.min(stats.min, value));
          const max = Math.ceil(Math.max(stats.max, value));
          return (
            <div key={line.ingredientName} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{line.ingredientName}</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatINR(value)}
                  <span className="text-default-400 font-normal">/{line.priceUnit}</span>
                </span>
              </div>
              <Slider
                aria-label={`Hypothetical price for ${line.ingredientName}`}
                size="sm"
                minValue={min}
                maxValue={max}
                step={Math.max((max - min) / 100, 0.01)}
                value={value}
                onChange={(v) =>
                  setOverrides((prev) => ({ ...prev, [line.ingredientName]: Number(v) }))
                }
              />
              <p className="text-default-400 text-xs">
                observed {formatINR(stats.min)}–{formatINR(stats.max)} over {stats.n} days
                {stats.spreadPct != null && ` · ranged ${stats.spreadPct.toFixed(0)}%`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between border-t border-default-100 pt-3">
        <span className="text-sm text-default-500">Scenario total</span>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tabular-nums">{formatINR(totals.total)}</span>
          {dirty && (
            <Tooltip content={`Base recipe costs ${formatINR(baseTotal)}`}>
              <Chip size="sm" variant="flat" color={delta > 0 ? "danger" : delta < 0 ? "success" : "default"}>
                {delta > 0 ? "+" : ""}
                {formatINR(delta)}
              </Chip>
            </Tooltip>
          )}
        </div>
      </div>
      <p className="text-default-400 text-xs">
        Scenario only — nothing here is saved to the recipe.
      </p>
    </div>
  );
}
