// Item 7: "log what I paid".
//
// Every other price in this system is a market proxy — a mandi modal price, a
// scraped MRP, an LLM guess. This is the only source that is ground truth for
// *my* costs, so it sits at the top of SOURCE_PRECEDENCE in libs/trends.js.
//
// It also doubles as validation for the feeds. "data.gov.in said ₹31/kg, the
// receipt says ₹48/kg" is a finding about data quality, not a data-entry error,
// and it is only visible because both numbers land in the same snapshot log.
//
// Pure: no mongoose, no fetch. The route in app/api/purchases/route.js does the
// writing. Tested in tests/purchases.test.mjs.

// Extensions are required: these are imported by tests/*.test.mjs under plain
// node ESM, which does not do extensionless resolution the way the bundler does.
import { PRICE_UNITS } from "./units.js";
import { istDay, istNoon, isValidDay } from "./istDay.js";

// A receipt is not priced per unit — it says "₹110" and "2 kg" on two different
// lines, and asking someone to divide before they can log a purchase is how a
// feature stops getting used. So the form takes what the receipt says.
//
// Rounded to 4 decimals rather than the 2 used elsewhere: per-gram prices are
// legitimate here ("₹60 for a 500 g pack" is ₹0.12/g), and 2 decimals would
// quantize that to ₹0.12 — a 0.4% error that compounds through every recipe
// line priced in grams.
const PRICE_DECIMALS = 4;

/** How far back a purchase may be backdated. Beyond this it's almost always a typo. */
export const MAX_BACKDATE_DAYS = 365;

/**
 * Turn what the receipt says into the observation we store.
 *
 * @param {object} raw
 * @param {string} raw.ingredientName
 * @param {number|string} raw.totalPaid  rupees on the receipt
 * @param {number|string} raw.quantity   how much that bought
 * @param {string} raw.priceUnit         the unit that quantity is in
 * @param {string} [raw.day]             IST day "YYYY-MM-DD", defaults to today
 * @param {string} [raw.note]            where it was bought, pack size, etc.
 * @param {Date}   [now]                 injectable clock, for tests
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function derivePurchase(raw, now = new Date()) {
  const ingredientName = String(raw?.ingredientName ?? "").trim();
  if (!ingredientName) return { ok: false, error: "which ingredient did you buy?" };

  const totalPaid = Number(raw?.totalPaid);
  if (!Number.isFinite(totalPaid) || totalPaid <= 0)
    return { ok: false, error: "amount paid must be more than ₹0" };

  const quantity = Number(raw?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { ok: false, error: "quantity must be more than 0" };

  const priceUnit = String(raw?.priceUnit ?? "kg");
  if (!PRICE_UNITS.includes(priceUnit))
    return { ok: false, error: `unit must be one of ${PRICE_UNITS.join(", ")}` };

  const today = istDay(now);
  const day = String(raw?.day ?? "").trim() || today;
  if (!isValidDay(day)) return { ok: false, error: `"${day}" is not a real date` };
  if (day > today) return { ok: false, error: "can't log a purchase in the future" };
  const ageDays = Math.round((istNoon(today) - istNoon(day)) / 86400000);
  if (ageDays > MAX_BACKDATE_DAYS)
    return { ok: false, error: `that's over ${MAX_BACKDATE_DAYS} days ago — check the date` };

  const factor = 10 ** PRICE_DECIMALS;
  const price = Math.round((totalPaid / quantity) * factor) / factor;
  if (!Number.isFinite(price) || price <= 0)
    return { ok: false, error: "that works out to ₹0 per unit" };

  return {
    ok: true,
    value: {
      ingredientName,
      price,
      priceUnit,
      totalPaid,
      quantity,
      observedOn: day,
      observedAt: istNoon(day),
      note: String(raw?.note ?? "").trim().slice(0, 200),
      // Whether this purchase should also move the *current* price.
      //
      // A receipt from today is the best available answer to "what does this
      // cost now". A receipt from three weeks ago is not — it belongs in the
      // history so the charts can see it, but overwriting today's price book
      // with it would make the daily sync look like it had regressed.
      isCurrent: day === today,
    },
  };
}

/**
 * How a logged purchase compares to whatever the price book already believed.
 * This is the feed-validation payoff, so it is computed for display rather than
 * hidden in an analysis pass nobody opens.
 *
 * @returns {{deltaPct: number, direction: "higher"|"lower"|"same"}|null}
 *          null when there's nothing to compare against
 */
export function comparePurchase(paidPrice, bookPrice) {
  const paid = Number(paidPrice);
  const book = Number(bookPrice);
  if (!Number.isFinite(paid) || !Number.isFinite(book) || book <= 0) return null;
  const deltaPct = ((paid - book) / book) * 100;
  return {
    deltaPct,
    direction: Math.abs(deltaPct) < 0.5 ? "same" : deltaPct > 0 ? "higher" : "lower",
  };
}
