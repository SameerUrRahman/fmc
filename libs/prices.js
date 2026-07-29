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
  note = "",
}) {
  const observedOn = istDay(observedAt);
  return PriceSnapshot.findOneAndUpdate(
    { ingredientName, source, observedOn },
    { ingredientName, knownIngredientId, price, priceUnit, source, observedOn, observedAt, note },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/** Update the price book by name and append the observation. */
export async function upsertPrice({ ingredientName, price, priceUnit, source = "manual", note = "" }) {
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
    note,
  });
  return known;
}

/**
 * Write a logged purchase (item 7).
 *
 * Takes the already-validated shape from derivePurchase(). Two paths, and the
 * split is the whole point: a purchase made *today* is the best current answer
 * to "what does this cost", so it updates the price book. A backdated one only
 * appends to history — moving the current price backwards to match a receipt
 * from three weeks ago would look exactly like the daily sync had broken.
 *
 * @param {object} purchase derivePurchase().value
 * @returns {Promise<{snapshot: object, known: object|null, updatedBook: boolean}>}
 */
export async function recordPurchase(purchase) {
  const { ingredientName, price, priceUnit, observedAt, note, isCurrent } = purchase;

  if (isCurrent) {
    const known = await upsertPrice({
      ingredientName,
      price,
      priceUnit,
      source: "purchase",
      note,
    });
    return { known, updatedBook: true };
  }

  // Backdated: link to the price-book row if one exists, but don't create or
  // touch it. A snapshot can legitimately predate its price-book entry.
  const known = await KnownIngredients.findOne({ ingredientName }).lean();
  const snapshot = await recordSnapshot({
    ingredientName,
    knownIngredientId: known?._id,
    price,
    priceUnit,
    source: "purchase",
    observedAt,
    note,
  });
  return { snapshot, known, updatedBook: false };
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
