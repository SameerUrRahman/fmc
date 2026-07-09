// Best-effort BigBasket price scraper for packaged goods the mandi data
// doesn't cover (butter, cheese, cocoa...). Personal-scale use: one run a
// day, a handful of SKUs, generous delays.
//
// Setup (Playwright is NOT a project dependency — install on demand):
//   npm i -D playwright
//   npx playwright install chromium
// Run:
//   node scripts/scrape_bigbasket.mjs
//
// Each SKU: search query + pack size -> price per canonical unit.
import { connect, upsertPrice } from "./_shared.mjs";

const SKUS = [
  { ingredientName: "butter", query: "amul butter 500 g", packQty: 0.5, priceUnit: "kg" },
  { ingredientName: "cheese", query: "amul cheese slices 200 g", packQty: 0.2, priceUnit: "kg" },
  { ingredientName: "paneer", query: "fresh paneer 200 g", packQty: 0.2, priceUnit: "kg" },
  { ingredientName: "cocoa powder", query: "cadbury cocoa powder 150 g", packQty: 0.15, priceUnit: "kg" },
  { ingredientName: "condensed milk", query: "milkmaid 380 g", packQty: 0.38, priceUnit: "kg" },
  { ingredientName: "sunflower oil", query: "sunflower oil 1 l", packQty: 1, priceUnit: "L" },
  { ingredientName: "ghee", query: "ghee 500 ml", packQty: 0.5, priceUnit: "L" },
  { ingredientName: "eggs", query: "eggs 6 pieces", packQty: 6, priceUnit: "piece" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
});

const results = [];
for (const sku of SKUS) {
  try {
    await page.goto(`https://www.bigbasket.com/ps/?q=${encodeURIComponent(sku.query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await sleep(4000 + Math.random() * 3000); // let hydration finish; stay polite

    // Grab the first visible "₹<number>" on the results — the top product's
    // selling price. Brittle by nature; log loudly when it stops matching.
    const priceText = await page.evaluate(() => {
      const m = document.body.innerText.match(/₹\s*([\d,]+(?:\.\d+)?)/);
      return m ? m[1] : null;
    });
    if (!priceText) {
      console.warn(`no price found for "${sku.query}" — page layout may have changed or bot-blocked`);
      continue;
    }
    const packPrice = Number(priceText.replace(/,/g, ""));
    const perUnit = Math.round((packPrice / sku.packQty) * 100) / 100;
    results.push({ ingredientName: sku.ingredientName, price: perUnit, priceUnit: sku.priceUnit });
    console.log(`${sku.ingredientName}: pack ₹${packPrice} -> ₹${perUnit}/${sku.priceUnit}`);
  } catch (e) {
    console.warn(`failed for "${sku.query}": ${e.message}`);
  }
  await sleep(3000 + Math.random() * 2000);
}
await browser.close();

if (results.length === 0) {
  console.log("Nothing scraped — price book left untouched.");
  process.exit(0);
}

const mongoose = await connect();
for (const r of results) {
  await upsertPrice({ ...r, source: "bigbasket" });
}
console.log(`\nDone: ${results.length}/${SKUS.length} prices updated from BigBasket.`);
await mongoose.disconnect();
