"use client";
import { Chip, Tooltip } from "@heroui/react";
import { useMemo } from "react";
import { contributions } from "@/libs/trends";
import { formatINR } from "@/libs/units";

/**
 * "Where does this recipe's cost actually go?" — ranked, largest first.
 *
 * A ranked bar chart, not a pie: the job is comparing magnitudes, and length
 * on a common baseline is read accurately where angle is not. One hue, because
 * the encoding is magnitude — the bars are not eight different things, they are
 * eight amounts of the same thing.
 */
export default function CostBreakdown({ lines, subtotal }) {
  const { ranked, uncosted } = useMemo(() => contributions(lines), [lines]);

  if (ranked.length === 0) {
    return (
      <p className="text-default-400 text-sm">
        Add ingredients with prices to see what drives the cost.
      </p>
    );
  }

  const top = ranked[0];
  // bars are scaled against the largest line, not the total: at 8 ingredients
  // every bar would otherwise be a stub and the ranking would be unreadable
  const scaleMax = top.cost;

  return (
    <div className="viz flex flex-col gap-3">
      <p className="text-default-500 text-sm">
        <span className="text-foreground font-semibold">{top.ingredientName}</span> is{" "}
        {(top.share * 100).toFixed(0)}% of ingredient cost
        {ranked.length > 1 && (
          <>
            , {(top.cost / ranked[1].cost).toFixed(1)}× the next line ({ranked[1].ingredientName})
          </>
        )}
        .
      </p>

      <div className="flex flex-col gap-2">
        {ranked.map((l) => (
          <div key={l.ingredientName} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-default-500" title={l.ingredientName}>
              {l.ingredientName}
            </span>
            <div className="h-3 flex-1 rounded-sm bg-content2">
              <div
                className="h-3 rounded-sm"
                style={{
                  width: `${Math.max((l.cost / scaleMax) * 100, 1.5)}%`,
                  backgroundColor: "var(--viz-series-1)",
                }}
              />
            </div>
            {/* value in text ink beside a colored mark, never colored text */}
            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
              {formatINR(l.cost)}
            </span>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-default-400">
              {(l.share * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {uncosted.length > 0 && (
        <Tooltip
          content={uncosted.map((u) => `${u.ingredientName}: ${u.error}`).join(" · ")}
          className="max-w-72"
        >
          <Chip size="sm" variant="flat" color="warning" className="w-fit">
            {uncosted.length} line{uncosted.length > 1 ? "s" : ""} not costed — excluded from shares
          </Chip>
        </Tooltip>
      )}
      <p className="text-default-400 text-xs">
        Shares are of the {formatINR(subtotal)} ingredient subtotal, before overhead.
      </p>
    </div>
  );
}
