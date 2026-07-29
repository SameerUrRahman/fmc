// Server-only read path over the PriceSnapshot log.
//
// Imports the mongoose model, so this must never be pulled into a client
// component. The pure analysis that runs on the result lives in libs/trends.js.

import PriceSnapshot from "@/models/PriceSnapshot";
import { dailySeries, seriesStats } from "./trends";

// How far back the charts look. 90 days covers the 6-8 weeks the trend work
// needs while keeping the query small enough to run on every page render.
export const DEFAULT_WINDOW_DAYS = 90;

// istDay() moved to libs/istDay.js so pure code and tests can use it without
// importing the mongoose model above. Re-exported here for existing callers.
export { istDay } from "./istDay";
import { istDay } from "./istDay";

/**
 * Daily price series for a set of ingredients, ready to hand to a client
 * component (plain JSON, no mongoose documents).
 *
 * Each ingredient's observations are restated in the price unit the caller
 * gives for it, so a unit change in the price book doesn't chart as a price
 * spike. See dailySeries() for how same-day readings from different feeds are
 * resolved.
 *
 * @param {Array<{ingredientName: string, priceUnit?: string}>} ingredients
 * @param {number} days lookback window
 * @returns {Promise<Object>} { [ingredientName]: { points, sources, stats, dropped } }
 */
export async function getHistoryFor(ingredients, days = DEFAULT_WINDOW_DAYS) {
  const names = [...new Set((ingredients || []).map((i) => i.ingredientName).filter(Boolean))];
  if (names.length === 0) return {};

  const since = istDay(new Date(Date.now() - days * 86400000));
  const rows = await PriceSnapshot.find({
    ingredientName: { $in: names },
    observedOn: { $gte: since },
  })
    .select("ingredientName price priceUnit source observedOn")
    .sort({ observedOn: 1 })
    .lean();

  const rowsByName = new Map(names.map((n) => [n, []]));
  for (const r of rows) rowsByName.get(r.ingredientName)?.push(r);

  const out = {};
  for (const ing of ingredients) {
    if (!ing.ingredientName || out[ing.ingredientName]) continue;
    const { points, sources, dropped } = dailySeries(rowsByName.get(ing.ingredientName) ?? [], {
      priceUnit: ing.priceUnit,
      ingredientName: ing.ingredientName,
    });
    out[ing.ingredientName] = {
      points,
      sources,
      dropped,
      priceUnit: ing.priceUnit ?? null,
      stats: seriesStats(points),
    };
  }
  return JSON.parse(JSON.stringify(out));
}
