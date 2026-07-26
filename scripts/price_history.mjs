// Inspect the price history from the terminal. The app now charts this too, but
// this stays the quickest sanity check that the daily cron is actually
// appending — and it reads raw rows, where the charts collapse multi-source
// days to one point.
//
//   node scripts/price_history.mjs            # summary across all ingredients
//   node scripts/price_history.mjs onion      # one ingredient's series
import { connect, PriceSnapshot } from "./_shared.mjs";

const query = process.argv[2];
const mongoose = await connect();

const total = await PriceSnapshot.countDocuments();
if (total === 0) {
  console.log("No snapshots yet. Run `npm run prices:backfill`, then `npm run prices:gov`.");
  await mongoose.disconnect();
  process.exit(0);
}

if (query) {
  const rows = await PriceSnapshot.find({
    ingredientName: new RegExp(query, "i"),
  })
    .sort({ observedOn: 1, observedAt: 1 })
    .lean();

  if (rows.length === 0) {
    console.log(`No snapshots matching "${query}".`);
  } else {
    console.log(`${rows.length} observation(s) matching "${query}":\n`);
    console.log("DAY         INGREDIENT        SOURCE          PRICE   CHANGE");
    console.log("-".repeat(66));
    const prevBySeries = new Map();
    for (const r of rows) {
      const key = `${r.ingredientName}|${r.source}`;
      const prev = prevBySeries.get(key);
      let change = "";
      if (prev !== undefined && prev !== 0) {
        const pct = ((r.price - prev) / prev) * 100;
        change = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
      }
      prevBySeries.set(key, r.price);
      console.log(
        r.observedOn.padEnd(11),
        r.ingredientName.slice(0, 17).padEnd(17),
        String(r.source).slice(0, 15).padEnd(15),
        `${String(r.price).padStart(6)}/${r.priceUnit}`.padEnd(11),
        change.padStart(7)
      );
    }
  }
} else {
  const days = await PriceSnapshot.distinct("observedOn");
  const ingredients = await PriceSnapshot.distinct("ingredientName");
  console.log(`${total} snapshots | ${ingredients.length} ingredients | ${days.length} day(s)`);
  console.log(`range: ${days.sort()[0]} -> ${days[days.length - 1]}\n`);

  const perIngredient = await PriceSnapshot.aggregate([
    {
      $group: {
        _id: "$ingredientName",
        n: { $sum: 1 },
        min: { $min: "$price" },
        max: { $max: "$price" },
        last: { $last: "$price" },
        sources: { $addToSet: "$source" },
      },
    },
    { $sort: { n: -1, _id: 1 } },
  ]);

  console.log("INGREDIENT           OBS   MIN     MAX     LATEST  SPREAD  SOURCES");
  console.log("-".repeat(76));
  for (const r of perIngredient) {
    // spread = how much this ingredient has moved so far; the volatility signal
    // that task 9 will use to decide how stale is "too stale" per ingredient.
    const spread = r.min > 0 ? `${(((r.max - r.min) / r.min) * 100).toFixed(0)}%` : "—";
    console.log(
      String(r._id).slice(0, 20).padEnd(20),
      String(r.n).padStart(3),
      String(r.min).padStart(7),
      String(r.max).padStart(7),
      String(r.last).padStart(7),
      spread.padStart(7),
      "  " + r.sources.join(", ")
    );
  }
  console.log("\nTip: `npm run prices:history -- onion` for one ingredient's series.");
}

await mongoose.disconnect();
