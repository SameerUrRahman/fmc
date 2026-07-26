import mongoose, { Schema } from "mongoose";

// Append-only observation log for ingredient prices.
//
// KnownIngredients holds the *current* price (a materialized view, overwritten
// on every sync). This collection holds every price we have ever observed, so
// history survives the daily cron instead of being destroyed by it.
//
// One document = "source S said ingredient I cost P on day D".
//
// NOTE: the scripts can't import this file (they are .mjs, this is ESM-in-.js
// which plain node reads as CJS), so scripts/_shared.mjs keeps a copy of this
// schema. Change both together.
const priceSnapshotSchema = new Schema(
  {
    ingredientName: { type: String, required: true, trim: true },
    // denormalized link to the price book; the name is the real key, since
    // snapshots can predate a price-book entry (e.g. from a wanted-list lookup)
    knownIngredientId: { type: Schema.Types.ObjectId, ref: "KnownIngredients" },
    price: { type: Number, required: true, min: 0 },
    priceUnit: { type: String, required: true, default: "kg" },
    // manual | data.gov.in | doca-retail | bigbasket | purchase | llm-estimate
    source: { type: String, required: true, default: "manual" },
    // IST calendar day as "YYYY-MM-DD". This, not observedAt, is the dedupe key:
    // the cron runs at 09:00 IST, and truncating a UTC timestamp to midnight
    // would split a single Indian day across two buckets.
    observedOn: { type: String, required: true },
    // the real instant we recorded it, kept for ordering within a day
    observedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// One observation per ingredient per source per day. Re-running a sync on the
// same day overwrites that day's reading rather than appending a duplicate.
priceSnapshotSchema.index(
  { ingredientName: 1, source: 1, observedOn: 1 },
  { unique: true }
);
// Read path: "give me this ingredient's history, newest first".
priceSnapshotSchema.index({ ingredientName: 1, observedAt: -1 });

const PriceSnapshot =
  mongoose.models.PriceSnapshot ||
  mongoose.model("PriceSnapshot", priceSnapshotSchema);
export default PriceSnapshot;
