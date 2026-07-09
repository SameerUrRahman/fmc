// Pull daily wholesale/mandi prices from data.gov.in (Agmarknet, Ministry of
// Agriculture "Current Daily Price of Various Commodities" dataset) and
// upsert them into the price book.
//
// Setup: get a free API key at https://data.gov.in (My Account -> API key),
// then add DATA_GOV_API_KEY=... to .env (or a GitHub Actions secret).
//
//   node scripts/fetch_gov_prices.mjs [--state Telangana] [--district Hyderabad]
import { connect, loadEnv, upsertPrice } from "./_shared.mjs";

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

async function fetchRecords(filters) {
  const url = new URL(`https://api.data.gov.in/resource/${RESOURCE}`);
  url.searchParams.set("api-key", API_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1000");
  for (const [k, v] of Object.entries(filters)) {
    url.searchParams.set(`filters[${k}]`, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`data.gov.in responded ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.records ?? [];
}

// Try district first; markets don't report every day, so fall back to state.
let records = await fetchRecords({ state, district });
if (records.length === 0) {
  console.log(`No records for ${district} today, falling back to all of ${state}...`);
  records = await fetchRecords({ state });
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
  console.log("No mapped commodities found in today's records — nothing to update.");
  process.exit(0);
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
