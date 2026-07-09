// One-time migration: the old app stored a single flat `ingredients`
// collection (one implicit recipe). This wraps whatever is in there into a
// Recipe called "Imported recipe" so no data is lost, and leaves the old
// collection untouched.
//
//   node scripts/migrate_ingredients.mjs
import { connect } from "./_shared.mjs";
import mongoose from "mongoose";

const conn = await connect();
const db = mongoose.connection.db;

const old = await db.collection("ingredients").find().toArray();
if (old.length === 0) {
  console.log("Old `ingredients` collection is empty — nothing to migrate.");
  await conn.disconnect();
  process.exit(0);
}

const WEIGHT = ["g", "kg", "oz", "pound"];
const VOLUME = ["mL", "L", "tsp", "tbsp", "cup", "gallon"];

const lines = old
  .filter((doc) => doc.ingredientName)
  .map((doc) => {
    const unit = doc.unit && (WEIGHT.includes(doc.unit) || VOLUME.includes(doc.unit)) ? doc.unit
      : doc.unit === "Each" || doc.unit === "dozen" ? (doc.unit === "dozen" ? "dozen" : "piece")
      : "g";
    // Old `cost` was "cost per kg/L" per the form label
    const priceUnit = WEIGHT.includes(unit) ? "kg" : VOLUME.includes(unit) ? "L" : "piece";
    return {
      ingredientName: doc.ingredientName,
      quantity: Number(doc.quantity) || 0,
      unit,
      price: Number(doc.cost) || 0,
      priceUnit,
    };
  });

const existing = await db.collection("recipes").findOne({ name: "Imported recipe" });
if (existing) {
  console.log("An 'Imported recipe' already exists — skipping to avoid duplicates.");
} else {
  await db.collection("recipes").insertOne({
    name: "Imported recipe",
    servings: 1,
    overheadPct: 0,
    ingredients: lines,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`Migrated ${lines.length} old ingredient rows into "Imported recipe".`);
  console.log("Old `ingredients` collection left as-is; drop it manually when happy.");
}

await conn.disconnect();
