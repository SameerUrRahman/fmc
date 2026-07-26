// Server-side price writer for the app's own routes.
//
// The .mjs scripts get this from scripts/_shared.mjs; the Next routes can't
// import that file, so this is the same contract for the web side: every price
// write updates the current-price view AND appends an observation.
//
// Without this, editing a price in the Price Book UI overwrote the current
// value and left no trace in the history the trend charts read.

import KnownIngredients from "@/models/knownIngredient";
import PriceSnapshot from "@/models/PriceSnapshot";
import { istDay } from "./priceHistory";

/**
 * Append one observation. Idempotent per (ingredient, source, IST day), so
 * editing the same price twice in a day corrects that day rather than
 * duplicating it — matching recordSnapshot() in scripts/_shared.mjs.
 */
export async function recordSnapshot({
  ingredientName,
  knownIngredientId,
  price,
  priceUnit,
  source = "manual",
  observedAt = new Date(),
}) {
  const observedOn = istDay(observedAt);
  return PriceSnapshot.findOneAndUpdate(
    { ingredientName, source, observedOn },
    { ingredientName, knownIngredientId, price, priceUnit, source, observedOn, observedAt },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/** Update the price book by name and append the observation. */
export async function upsertPrice({ ingredientName, price, priceUnit, source = "manual" }) {
  const now = new Date();
  const known = await KnownIngredients.findOneAndUpdate(
    { ingredientName },
    { ingredientName, price, priceUnit, source, fetchedAt: now },
    { new: true, upsert: true }
  );
  await recordSnapshot({
    ingredientName,
    knownIngredientId: known?._id,
    price,
    priceUnit,
    source,
    observedAt: now,
  });
  return known;
}

/** Same, for an edit that addresses the row by id (the Price Book's Save button). */
export async function updatePriceById(id, value) {
  const now = new Date();
  const known = await KnownIngredients.findByIdAndUpdate(
    id,
    { ...value, fetchedAt: now },
    { new: true }
  );
  if (!known) return null;
  await recordSnapshot({
    ingredientName: known.ingredientName,
    knownIngredientId: known._id,
    price: known.price,
    priceUnit: known.priceUnit,
    source: known.source || "manual",
    observedAt: now,
  });
  return known;
}
