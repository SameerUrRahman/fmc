// One-time: seed the price history from whatever the price book currently
// holds, so the first chart isn't empty and today's readings aren't lost.
//
// Each price-book entry becomes a single snapshot dated by its own fetchedAt,
// which is the only observation date we actually know for it. Everything before
// that is genuinely gone — the sync overwrote it in place. From here on
// upsertPrice() appends as it goes.
//
// Safe to re-run: recordSnapshot() upserts on (ingredient, source, IST day).
//
//   node scripts/backfill_snapshots.mjs
import { connect, KnownIngredients, PriceSnapshot, recordSnapshot, istDay } from "./_shared.mjs";

const mongoose = await connect();

// Make sure the unique (ingredient, source, day) index exists before we write.
await PriceSnapshot.syncIndexes();

const knowns = await KnownIngredients.find().lean();
if (knowns.length === 0) {
  console.log("Price book is empty — nothing to backfill. Run `npm run seed` first.");
  await mongoose.disconnect();
  process.exit(0);
}

const before = await PriceSnapshot.countDocuments();
const byDay = new Map();

for (const k of knowns) {
  const observedAt = k.fetchedAt ? new Date(k.fetchedAt) : new Date(k.updatedAt ?? Date.now());
  await recordSnapshot({
    ingredientName: k.ingredientName,
    knownIngredientId: k._id,
    price: k.price,
    priceUnit: k.priceUnit,
    source: k.source || "manual",
    observedAt,
  });
  const day = istDay(observedAt);
  byDay.set(day, (byDay.get(day) ?? 0) + 1);
}

const after = await PriceSnapshot.countDocuments();

console.log(`Backfilled from ${knowns.length} price-book entries.`);
console.log(`Snapshots: ${before} -> ${after} (${after - before} new)\n`);
console.log("Observations by IST day:");
for (const [day, n] of [...byDay].sort()) {
  console.log(`  ${day}  ${String(n).padStart(3)} ingredient${n === 1 ? "" : "s"}`);
}

const bySource = await PriceSnapshot.aggregate([
  { $group: { _id: "$source", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log("\nBy source:");
for (const s of bySource) console.log(`  ${String(s._id).padEnd(14)} ${s.n}`);

await mongoose.disconnect();
