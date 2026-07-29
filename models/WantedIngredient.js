import mongoose, { Schema } from "mongoose";

// Item 6: the wanted list.
//
// When a price lookup misses, the miss itself is worth keeping. It's the queue
// the manual packaged-goods scrape (item 10) works through first, and it is the
// only record of which ingredients this system cannot price — which is a more
// useful thing to know than any individual failed lookup.
//
// One document per ingredient name, not per attempt: `timesRequested` counts
// the attempts, so a staple that gets looked up weekly rises to the top of the
// list without generating a week of rows.
const wantedIngredientSchema = new Schema(
  {
    ingredientName: { type: String, required: true, trim: true, unique: true },
    // how many times someone has asked for a price and not got a good one
    timesRequested: { type: Number, default: 1 },
    lastAttemptAt: { type: Date, default: Date.now },
    // pending  — still unpriced, belongs in the scrape queue
    // resolved — a lookup eventually produced a price
    status: { type: String, enum: ["pending", "resolved"], default: "pending" },
    // what finally answered it: data.gov.in | llm-estimate | purchase | manual
    resolvedSource: { type: String, default: null },
    // why the last attempt failed, for triage ("no matching commodity")
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

// Read path: the queue, worst first.
wantedIngredientSchema.index({ status: 1, timesRequested: -1 });

const WantedIngredient =
  mongoose.models.WantedIngredient ||
  mongoose.model("WantedIngredient", wantedIngredientSchema);
export default WantedIngredient;
