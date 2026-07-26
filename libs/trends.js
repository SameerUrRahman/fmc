// Pure, deterministic analysis over price history.
//
// Nothing here touches the database or React — it takes snapshot rows that the
// server already fetched and turns them into the numbers the charts draw. Kept
// separate from libs/priceHistory.js (which imports the mongoose model and is
// therefore server-only) so the same functions run on both sides and can be
// unit-tested without a database.

import { convertPrice, densityFor, lineCost, recipeCost } from "./units";

// Which feed to believe when several have an opinion about the same ingredient
// on the same day. Highest first. `purchase` is what I actually paid, so it
// outranks every market proxy; an LLM guess is the last resort.
//
// Tiers are allowed to be absent — most of these sources don't exist yet — so
// this is a ranking function, not a fixed chain of fallbacks.
export const SOURCE_PRECEDENCE = [
  "purchase",
  "doca-retail",
  "bigbasket",
  "data.gov.in",
  "manual",
  "llm-estimate",
];

export function sourceRank(source) {
  const i = SOURCE_PRECEDENCE.indexOf(source);
  return i === -1 ? SOURCE_PRECEDENCE.length : i;
}

/**
 * A series needs at least two *distinct days* before it can be drawn as a
 * trend. One observation is a dot, not a line, and the backfilled rows are one
 * observation each — charting them would draw a confident flat line over data
 * that says nothing. Everything in this file that returns a chart shape reports
 * `enough` so the UI can say "not enough history yet" instead of lying.
 */
export const MIN_TREND_POINTS = 2;

/**
 * Collapse raw snapshots for ONE ingredient into a single daily series.
 *
 * @param {Array} rows snapshot docs: { price, priceUnit, source, observedOn }
 * @param {object} opts
 * @param {string} opts.priceUnit unit to restate every observation in
 * @param {string} opts.ingredientName used for density when units cross type
 * @returns {{points: Array<{day,price,source}>, sources: string[], dropped: number}}
 */
export function dailySeries(rows, { priceUnit, ingredientName } = {}) {
  const density = densityFor(ingredientName);
  const byDay = new Map();
  const sources = new Set();
  let dropped = 0;

  for (const r of rows || []) {
    const price = priceUnit
      ? convertPrice(r.price, r.priceUnit, priceUnit, density)
      : r.price;
    // a gram price against a per-piece book entry can't be reconciled; skipping
    // is right, but silently skipping is not — the count is reported
    if (price === null || !Number.isFinite(price)) {
      dropped += 1;
      continue;
    }
    sources.add(r.source);
    const existing = byDay.get(r.observedOn);
    // one point per day: the most trustworthy source wins, ties broken by the
    // later reading, matching how the price book itself would resolve them
    if (!existing || sourceRank(r.source) < sourceRank(existing.source)) {
      byDay.set(r.observedOn, { day: r.observedOn, price, source: r.source });
    }
  }

  const points = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { points, sources: [...sources].sort(), dropped };
}

/**
 * Descriptive stats for a daily series. `range` is the observed floor/ceiling
 * that bounds the what-if slider — the point being that the slider offers
 * prices this ingredient has actually traded at, not arbitrary ones.
 */
export function seriesStats(points) {
  if (!points || points.length === 0) {
    return { n: 0, enough: false, min: null, max: null, first: null, last: null, changePct: null, spreadPct: null };
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const first = prices[0];
  const last = prices[prices.length - 1];
  return {
    n: points.length,
    enough: points.length >= MIN_TREND_POINTS,
    min,
    max,
    first,
    last,
    firstDay: points[0].day,
    lastDay: points[points.length - 1].day,
    changePct: first > 0 ? ((last - first) / first) * 100 : null,
    // how far this ingredient has ranged relative to its floor — the volatility
    // signal roadmap item 8 wants for per-ingredient staleness thresholds
    spreadPct: min > 0 ? ((max - min) / min) * 100 : null,
  };
}

/**
 * Ranked cost contribution: which ingredients actually drive this recipe's cost.
 *
 * Shares are computed against the sum of the lines that *could* be costed.
 * Lines that can't (no price, unconvertible units) are returned separately
 * rather than folded in as zero — a ₹0 line silently deflating every other
 * line's share is exactly the misreading this chart exists to prevent.
 */
export function contributions(lines) {
  const priced = [];
  const uncosted = [];
  for (const line of lines || []) {
    if (!line.ingredientName || line.ingredientName.trim() === "") continue;
    const { cost, error } = lineCost(line);
    if (cost === null || !Number.isFinite(cost)) {
      uncosted.push({ ingredientName: line.ingredientName, error });
    } else {
      priced.push({ ingredientName: line.ingredientName, cost });
    }
  }
  const subtotal = priced.reduce((s, l) => s + l.cost, 0);
  const ranked = priced
    .map((l) => ({ ...l, share: subtotal > 0 ? l.cost / subtotal : 0 }))
    .sort((a, b) => b.cost - a.cost);
  return { ranked, uncosted, subtotal };
}

/**
 * Replay a recipe's cost across every day we have prices for.
 *
 * For each day, each ingredient is priced at its most recent observation on or
 * before that day (last-observation-carried-forward). Feeds report on their own
 * cadence and not every ingredient is in every feed, so requiring all
 * ingredients to have a reading on the same day would leave almost no days at
 * all. Ingredients with no observation *yet* on a given day fall back to their
 * current line price, and `coverage` reports what fraction of that day's cost
 * came from real observations — so a nearly-flat line can be read as "we only
 * have history for one of eight ingredients" rather than "prices were stable".
 *
 * @param {Array} lines recipe lines
 * @param {Object} historyByName { [ingredientName]: Array<{day, price}> } already unit-normalized
 * @returns {{points: Array<{day,total,perServing,coverage}>, enough: boolean, tracked: string[], untracked: string[]}}
 */
export function recipeCostSeries(lines, historyByName, { servings = 1, overheadPct = 0 } = {}) {
  const active = (lines || []).filter((l) => l.ingredientName && l.ingredientName.trim() !== "");
  const tracked = [];
  const untracked = [];
  const days = new Set();

  for (const line of active) {
    const series = historyByName?.[line.ingredientName];
    if (series && series.length >= MIN_TREND_POINTS) {
      tracked.push(line.ingredientName);
      for (const p of series) days.add(p.day);
    } else {
      untracked.push(line.ingredientName);
    }
  }

  const sortedDays = [...days].sort();
  if (tracked.length === 0 || sortedDays.length < MIN_TREND_POINTS) {
    return { points: [], enough: false, tracked, untracked };
  }

  const points = sortedDays.map((day) => {
    let observedCost = 0;
    const dayLines = active.map((line) => {
      const series = historyByName?.[line.ingredientName];
      const asOf = lastOnOrBefore(series, day);
      if (asOf === null) return line;
      return { ...line, price: asOf };
    });
    const totals = recipeCost(dayLines, { servings, overheadPct });
    // coverage: share of this day's ingredient cost backed by a real observation
    dayLines.forEach((line, i) => {
      const series = historyByName?.[line.ingredientName];
      if (lastOnOrBefore(series, day) !== null) observedCost += totals.lines[i].cost ?? 0;
    });
    return {
      day,
      total: totals.total,
      perServing: totals.perServing,
      coverage: totals.subtotal > 0 ? observedCost / totals.subtotal : 0,
    };
  });

  return { points, enough: true, tracked, untracked };
}

// Most recent price on or before `day`, or null if the series starts later.
function lastOnOrBefore(series, day) {
  if (!series || series.length === 0) return null;
  let found = null;
  for (const p of series) {
    if (p.day <= day) found = p.price;
    else break;
  }
  return found;
}

/**
 * Map a numeric series to an SVG polyline path in a `width` x `height` box.
 * A flat series is drawn down the vertical middle rather than at y=0.
 */
export function sparkPath(values, width, height, pad = 1) {
  if (!values || values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerH = height - pad * 2;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = values.length > 1 ? i * step : width / 2;
      const y = span === 0 ? height / 2 : pad + innerH - ((v - min) / span) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
