// Item 6, first tier: a live price lookup against data.gov.in.
//
// Same resource and key as the daily cron in scripts/fetch_gov_prices.mjs, but
// asked a different question. The cron sweeps a fixed commodity map on a
// schedule; this asks "does the feed know anything about *this* name, right
// now" on an explicit user action.
//
// Deliberately NOT a headless browser or a retail scrape. Vercel egress is
// datacenter IPs, so a live scrape from a request handler gets blocked, and the
// failure would be synchronous and user-facing. A JSON API either answers or
// doesn't.

// Extension required — tests/priceLookup.test.mjs imports this under plain
// node ESM, which has no extensionless resolution.
import { matchKnownIngredient } from "./ingredientMatch.js";

const RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070";

// Higher than MATCH_THRESHOLD (0.6) used for the price book.
//
// The two mistakes are not symmetric. A loose price-book match shows the user a
// suggested price next to the name it came from, and they see it's wrong. A
// loose commodity match silently writes "cardamom" prices onto "coriander"
// under an authoritative-looking `data.gov.in` source label, and nothing
// downstream ever questions it again.
export const COMMODITY_MATCH_THRESHOLD = 0.72;

/**
 * Collapse raw Agmarknet records into one ₹/kg figure per commodity.
 *
 * modal_price is ₹ per quintal (100 kg) and several markets report the same
 * commodity on the same day, so this mirrors what the cron does: convert, then
 * average across markets.
 *
 * Pure — takes records, returns a Map. Tested in tests/priceLookup.test.mjs.
 *
 * @param {Array<{commodity: string, modal_price: string|number, market?: string}>} records
 * @returns {Map<string, {perKg: number, markets: number}>}
 */
export function perKgByCommodity(records) {
  const buckets = new Map();
  for (const r of records ?? []) {
    const commodity = String(r?.commodity ?? "").trim();
    if (!commodity) continue;
    const perKg = Number(r?.modal_price) / 100;
    if (!Number.isFinite(perKg) || perKg <= 0) continue;
    if (!buckets.has(commodity)) buckets.set(commodity, []);
    buckets.get(commodity).push(perKg);
  }

  const out = new Map();
  for (const [commodity, prices] of buckets) {
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    out.set(commodity, { perKg: Math.round(avg * 100) / 100, markets: prices.length });
  }
  return out;
}

/**
 * Best commodity in the feed for an ingredient name, or null below threshold.
 *
 * Reuses the price-book matcher rather than a second commodity map: it already
 * strips prep descriptors ("finely chopped"), translates Hinglish ("pyaz" ->
 * "onion"), and does bigram similarity with a containment boost. Feeding it
 * synthetic one-field documents gets all of that for free, and means an alias
 * added for the importer improves lookups too.
 *
 * Pure. @returns {{commodity: string, perKg: number, markets: number, score: number}|null}
 */
export function matchCommodity(ingredientName, byCommodity) {
  const candidates = [...byCommodity.keys()].map((c) => ({ ingredientName: c }));
  const { known, score } = matchKnownIngredient(ingredientName, candidates);
  if (!known || score < COMMODITY_MATCH_THRESHOLD) return null;
  const hit = byCommodity.get(known.ingredientName);
  if (!hit) return null;
  return {
    commodity: known.ingredientName,
    perKg: hit.perKg,
    markets: hit.markets,
    score: Math.round(score * 100) / 100,
  };
}

async function fetchRecords(apiKey, filters) {
  const url = new URL(`https://api.data.gov.in/resource/${RESOURCE}`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1000");
  for (const [k, v] of Object.entries(filters)) {
    url.searchParams.set(`filters[${k}]`, v);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`data.gov.in responded ${res.status}`);
  const data = await res.json();
  return data.records ?? [];
}

/**
 * Look one ingredient up in today's mandi feed.
 *
 * @param {string} ingredientName
 * @param {{state?: string, apiKey?: string}} [options]
 * @returns {Promise<{ok: true, price, priceUnit, source, detail}
 *                 | {ok: false, reason: string}>}
 *
 * Never throws: a lookup failure is an expected outcome the UI reports, not an
 * exception. The LLM tier upstream needs to know *that* this missed, not why it
 * threw.
 */
export async function lookupGovPrice(ingredientName, options = {}) {
  const apiKey = options.apiKey ?? process.env.DATA_GOV_API_KEY;
  if (!apiKey) return { ok: false, reason: "DATA_GOV_API_KEY is not configured" };

  const state = options.state ?? process.env.PRICE_FEED_STATE ?? "Telangana";
  let records;
  try {
    records = await fetchRecords(apiKey, { state });
  } catch (e) {
    return { ok: false, reason: `couldn't reach data.gov.in (${e.message})` };
  }
  if (records.length === 0) {
    return { ok: false, reason: `the feed reported no ${state} prices today` };
  }

  const hit = matchCommodity(ingredientName, perKgByCommodity(records));
  if (!hit) {
    return { ok: false, reason: "no matching commodity in the mandi feed" };
  }

  return {
    ok: true,
    price: hit.perKg,
    priceUnit: "kg",
    source: "data.gov.in",
    detail: `matched "${hit.commodity}" across ${hit.markets} ${state} market${
      hit.markets === 1 ? "" : "s"
    }`,
  };
}
