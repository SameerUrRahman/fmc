// Pull daily wholesale/mandi prices from data.gov.in (Agmarknet, Ministry of
// Agriculture "Current Daily Price of Various Commodities" dataset) and
// upsert them into the price book.
//
// Setup: get a free API key at https://data.gov.in (My Account -> API key),
// then add DATA_GOV_API_KEY=... to .env (or a GitHub Actions secret).
//
//   node scripts/fetch_gov_prices.mjs [--state Telangana] [--district Hyderabad]
//
// Outages: if the feed can't be reached (after retries) or has nothing to
// offer, the run passes with a warning as long as the price book's
// data.gov.in entries are fresher than PRICE_STALE_DAYS (default 7). Past
// that it fails, so a long outage still shows up as a red job.
import { connect, loadEnv, upsertPrice, PriceSnapshot } from "./_shared.mjs";
import { fetchWithRetry, FeedUnreachableError, daysSince } from "../libs/govFeed.js";

const RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070";

// commodity name (as it appears in Agmarknet) -> price-book ingredient name
const COMMODITY_MAP = {
  Onion: "onion",
  Potato: "potato",
  Tomato: "tomato",
  Garlic: "garlic",
  Ginger: "ginger",
  "Green Chilli": "green chilli",
  Lemon: "lemon (per kg)",
  Banana: "banana (per kg)",
  Apple: "apple",
  Carrot: "carrot",
  Cabbage: "cabbage",
  Cauliflower: "cauliflower",
  Brinjal: "brinjal",
  "Bhindi(Ladies Finger)": "bhindi",
  "Bengal Gram(Gram)(Whole)": "chana (whole)",
  "Arhar (Tur/Red Gram)(Whole)": "toor dal (whole)",
  "Green Gram (Moong)(Whole)": "moong (whole)",
  Wheat: "wheat (whole)",
  Rice: "rice",
  Sugar: "sugar",
  "Gur(Jaggery)": "jaggery",
  Groundnut: "groundnut",
  Coriander: "coriander leaves (per kg)",
};

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

loadEnv();
const API_KEY = process.env.DATA_GOV_API_KEY;
if (!API_KEY) {
  console.error("DATA_GOV_API_KEY is not set. Get a free key at https://data.gov.in and add it to .env");
  process.exit(1);
}

const state = getArg("state", "Telangana");
const district = getArg("district", "Hyderabad");
const STALE_DAYS = Number(process.env.PRICE_STALE_DAYS ?? 7);

async function fetchRecords(filters) {
  const url = new URL(`https://api.data.gov.in/resource/${RESOURCE}`);
  url.searchParams.set("api-key", API_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1000");
  for (const [k, v] of Object.entries(filters)) {
    url.searchParams.set(`filters[${k}]`, v);
  }
  const res = await fetchWithRetry(url, { log: console.log });
  const data = await res.json();
  return data.records ?? [];
}

// Nothing was updated this run. Pass with a warning while the existing
// data.gov.in prices are still recent; fail once they've gone stale.
// `::warning::` / `::error::` surface as annotations on the Actions run.
async function exitWithoutUpdate(reason) {
  const mongoose = await connect();
  // The snapshot log, not KnownIngredients: a later manual or BigBasket price
  // overwrites a KnownIngredients row's source, but never deletes history.
  const latest = await PriceSnapshot.findOne({ source: "data.gov.in" })
    .sort({ observedAt: -1 })
    .select("observedAt")
    .lean();
  await mongoose.disconnect();

  const age = daysSince(latest?.observedAt);
  const ageText = age === Infinity ? "never synced" : `last synced ${age} day${age === 1 ? "" : "s"} ago`;
  if (age > STALE_DAYS) {
    console.log(`::error::${reason} data.gov.in prices are stale (${ageText}, limit ${STALE_DAYS} days).`);
    process.exit(1);
  }
  console.log(`::warning::${reason} Keeping existing prices (${ageText}).`);
  process.exit(0);
}

// Try district first; markets don't report every day, so fall back to state.
let records;
try {
  records = await fetchRecords({ state, district });
  if (records.length === 0) {
    console.log(`No records for ${district} today, falling back to all of ${state}...`);
    records = await fetchRecords({ state });
  }
} catch (e) {
  if (!(e instanceof FeedUnreachableError)) throw e;
  await exitWithoutUpdate(`${e.message}.`);
}
console.log(`Fetched ${records.length} mandi price records for ${state}.`);

// modal_price is ₹ per quintal (100 kg). Average across markets per commodity.
const byCommodity = new Map();
for (const r of records) {
  const name = COMMODITY_MAP[r.commodity];
  if (!name) continue;
  const perKg = Number(r.modal_price) / 100;
  if (!Number.isFinite(perKg) || perKg <= 0) continue;
  if (!byCommodity.has(name)) byCommodity.set(name, []);
  byCommodity.get(name).push(perKg);
}

if (byCommodity.size === 0) {
  await exitWithoutUpdate("No mapped commodities found in today's records — nothing to update.");
}

const mongoose = await connect();
for (const [ingredientName, prices] of byCommodity) {
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const price = Math.round(avg * 100) / 100;
  await upsertPrice({ ingredientName, price, priceUnit: "kg", source: "data.gov.in" });
  console.log(`updated ${ingredientName}: ₹${price}/kg (${prices.length} market${prices.length === 1 ? "" : "s"})`);
}
console.log(`\nDone: ${byCommodity.size} price-book entries updated from data.gov.in.`);
console.log("Note: these are wholesale mandi prices — retail runs ~20-40% higher.");
await mongoose.disconnect();
