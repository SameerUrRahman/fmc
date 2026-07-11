import mongoose, { Schema } from "mongoose";

// The "price book": one document per ingredient the user cooks with,
// holding its current market price. Recipes reference these for autofill;
// the scraper/gov-data scripts update them.
const knownIngredientSchema = new Schema(
  {
    ingredientName: { type: String, required: true, trim: true, unique: true },
    // price per priceUnit, e.g. 42 per kg
    price: { type: Number, required: true, min: 0 },
    priceUnit: { type: String, required: true, default: "kg" },
    // alternate names (hindi/regional/spelling) used by the import matcher
    aliases: { type: [String], default: [] },
    // where this price came from: manual | data.gov.in | bigbasket | ...
    source: { type: String, default: "manual" },
    fetchedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

const KnownIngredients =
  mongoose.models.KnownIngredients ||
  mongoose.model("KnownIngredients", knownIngredientSchema);
export default KnownIngredients;
