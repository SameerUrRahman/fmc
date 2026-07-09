// Seed the price book with common Indian kitchen staples at reasonable
// starting prices (₹, roughly Hyderabad retail). Run once, then keep prices
// fresh manually or via fetch_gov_prices.mjs / scrape_bigbasket.mjs.
//
//   node scripts/seed_prices.mjs
import { connect, upsertPrice, KnownIngredients } from "./_shared.mjs";

const STAPLES = [
  { ingredientName: "atta (wheat flour)", price: 45, priceUnit: "kg" },
  { ingredientName: "maida", price: 48, priceUnit: "kg" },
  { ingredientName: "rice", price: 60, priceUnit: "kg" },
  { ingredientName: "basmati rice", price: 130, priceUnit: "kg" },
  { ingredientName: "sugar", price: 45, priceUnit: "kg" },
  { ingredientName: "jaggery", price: 70, priceUnit: "kg" },
  { ingredientName: "salt", price: 25, priceUnit: "kg" },
  { ingredientName: "toor dal", price: 160, priceUnit: "kg" },
  { ingredientName: "moong dal", price: 130, priceUnit: "kg" },
  { ingredientName: "chana dal", price: 100, priceUnit: "kg" },
  { ingredientName: "besan", price: 90, priceUnit: "kg" },
  { ingredientName: "milk", price: 60, priceUnit: "L" },
  { ingredientName: "curd", price: 70, priceUnit: "kg" },
  { ingredientName: "paneer", price: 400, priceUnit: "kg" },
  { ingredientName: "butter", price: 560, priceUnit: "kg" },
  { ingredientName: "ghee", price: 650, priceUnit: "L" },
  { ingredientName: "cheese", price: 480, priceUnit: "kg" },
  { ingredientName: "cream", price: 250, priceUnit: "L" },
  { ingredientName: "eggs", price: 84, priceUnit: "dozen" },
  { ingredientName: "chicken", price: 260, priceUnit: "kg" },
  { ingredientName: "sunflower oil", price: 140, priceUnit: "L" },
  { ingredientName: "groundnut oil", price: 190, priceUnit: "L" },
  { ingredientName: "coconut oil", price: 300, priceUnit: "L" },
  { ingredientName: "onion", price: 35, priceUnit: "kg" },
  { ingredientName: "tomato", price: 40, priceUnit: "kg" },
  { ingredientName: "potato", price: 30, priceUnit: "kg" },
  { ingredientName: "garlic", price: 120, priceUnit: "kg" },
  { ingredientName: "ginger", price: 90, priceUnit: "kg" },
  { ingredientName: "green chilli", price: 60, priceUnit: "kg" },
  { ingredientName: "coriander leaves", price: 15, priceUnit: "piece" },
  { ingredientName: "lemon", price: 5, priceUnit: "piece" },
  { ingredientName: "cocoa powder", price: 800, priceUnit: "kg" },
  { ingredientName: "chocolate (dark)", price: 900, priceUnit: "kg" },
  { ingredientName: "vanilla extract", price: 4000, priceUnit: "L" },
  { ingredientName: "baking powder", price: 400, priceUnit: "kg" },
  { ingredientName: "baking soda", price: 150, priceUnit: "kg" },
  { ingredientName: "condensed milk", price: 320, priceUnit: "kg" },
  { ingredientName: "honey", price: 450, priceUnit: "kg" },
  { ingredientName: "cashew", price: 800, priceUnit: "kg" },
  { ingredientName: "almond", price: 750, priceUnit: "kg" },
];

const mongoose = await connect();

// Old-schema documents (cost/unit/unitType) can't render in the new UI —
// migrate them in place instead of dropping them.
const legacy = await KnownIngredients.collection
  .find({ price: { $exists: false } })
  .toArray();
for (const doc of legacy) {
  const priceUnit =
    { g: "kg", kg: "kg", mL: "L", L: "L", Each: "piece", each: "piece" }[doc.unit] ?? "kg";
  await KnownIngredients.collection.updateOne(
    { _id: doc._id },
    {
      $set: { price: doc.cost ?? 0, priceUnit, source: "manual", fetchedAt: new Date() },
      $unset: { cost: "", unit: "", unitType: "" },
    }
  );
  console.log(`migrated legacy price-book entry: ${doc.ingredientName}`);
}

for (const item of STAPLES) {
  await upsertPrice({ ...item, source: "manual" });
  console.log(`seeded ${item.ingredientName} @ ₹${item.price}/${item.priceUnit}`);
}

console.log(`\nDone: ${STAPLES.length} staples seeded, ${legacy.length} legacy entries migrated.`);
await mongoose.disconnect();
