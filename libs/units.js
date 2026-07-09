// Unit conversion engine.
// Canonical units: g (weight), mL (volume), piece (count).
// Prices are entered per "price unit" (kg / L / piece etc.) and recipe
// quantities in any unit; line cost converts through the canonical unit.

export const UNIT_TYPES = {
  weight: { canonical: "g" },
  volume: { canonical: "mL" },
  count: { canonical: "piece" },
};

// factor = how many canonical units in 1 of this unit
export const UNITS = {
  // weight
  g: { label: "g", type: "weight", factor: 1 },
  kg: { label: "kg", type: "weight", factor: 1000 },
  oz: { label: "oz", type: "weight", factor: 28.35 },
  pound: { label: "pound", type: "weight", factor: 453.59 },
  // volume
  mL: { label: "mL", type: "volume", factor: 1 },
  L: { label: "L", type: "volume", factor: 1000 },
  tsp: { label: "tsp", type: "volume", factor: 4.93 },
  tbsp: { label: "tbsp", type: "volume", factor: 14.79 },
  cup: { label: "cup", type: "volume", factor: 240 },
  gallon: { label: "gallon", type: "volume", factor: 3785.41 },
  // count
  piece: { label: "piece", type: "count", factor: 1 },
  dozen: { label: "dozen", type: "count", factor: 12 },
};

export const QUANTITY_UNITS = Object.keys(UNITS);
// Units it makes sense to price by (per kg, per L, per piece…)
export const PRICE_UNITS = ["kg", "g", "L", "mL", "piece", "dozen"];

// Densities in g/mL for volume<->weight conversion of common kitchen
// ingredients. Matched by case-insensitive substring of the ingredient name.
export const DENSITIES = [
  { match: "water", density: 1.0 },
  { match: "milk", density: 1.03 },
  { match: "cream", density: 1.0 },
  { match: "curd", density: 1.03 },
  { match: "yogurt", density: 1.03 },
  { match: "butter", density: 0.91 },
  { match: "ghee", density: 0.91 },
  { match: "oil", density: 0.92 },
  { match: "honey", density: 1.42 },
  { match: "jaggery", density: 1.2 },
  { match: "sugar", density: 0.85 },
  { match: "maida", density: 0.53 },
  { match: "flour", density: 0.53 },
  { match: "atta", density: 0.55 },
  { match: "cocoa", density: 0.52 },
  { match: "cornflour", density: 0.55 },
  { match: "cornstarch", density: 0.55 },
  { match: "baking powder", density: 0.9 },
  { match: "baking soda", density: 1.1 },
  { match: "salt", density: 1.2 },
  { match: "rice", density: 0.85 },
  { match: "dal", density: 0.85 },
  { match: "besan", density: 0.54 },
  { match: "semolina", density: 0.6 },
  { match: "rava", density: 0.6 },
  { match: "suji", density: 0.6 },
  { match: "oats", density: 0.41 },
  { match: "vanilla", density: 0.88 },
  { match: "vinegar", density: 1.01 },
  { match: "sauce", density: 1.1 },
  { match: "ketchup", density: 1.14 },
  { match: "paneer", density: 1.0 },
  { match: "cheese", density: 1.0 },
  { match: "condensed milk", density: 1.29 },
  { match: "coconut milk", density: 0.97 },
  { match: "peanut butter", density: 1.09 },
];

export function densityFor(ingredientName) {
  if (!ingredientName) return null;
  const name = ingredientName.toLowerCase();
  // longest match wins ("baking powder" before "powder"-ish collisions)
  let best = null;
  for (const d of DENSITIES) {
    if (name.includes(d.match) && (!best || d.match.length > best.match.length)) {
      best = d;
    }
  }
  return best ? best.density : null;
}

/**
 * Convert a quantity between units, crossing weight<->volume via density
 * (g/mL) when needed. Returns a number, or null if the conversion is
 * impossible (unknown unit, count<->mass, or missing density).
 */
export function convertQuantity(quantity, fromUnit, toUnit, density = null) {
  const from = UNITS[fromUnit];
  const to = UNITS[toUnit];
  const qty = Number(quantity);
  if (!from || !to || !Number.isFinite(qty)) return null;

  if (from.type === to.type) {
    return (qty * from.factor) / to.factor;
  }
  // count never converts to mass/volume
  if (from.type === "count" || to.type === "count") return null;
  if (!density) return null;

  if (from.type === "volume" && to.type === "weight") {
    return (qty * from.factor * density) / to.factor;
  }
  if (from.type === "weight" && to.type === "volume") {
    return (qty * from.factor) / density / to.factor;
  }
  return null;
}

/**
 * Cost of one recipe line.
 * @param {object} line { quantity, unit, price, priceUnit, ingredientName }
 * @returns {{ cost: number|null, error: string|null }}
 */
export function lineCost(line) {
  const { quantity, unit, price, priceUnit, ingredientName } = line;
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return { cost: null, error: "no price" };
  if (!UNITS[unit]) return { cost: null, error: "unknown unit" };
  if (!UNITS[priceUnit]) return { cost: null, error: "unknown price unit" };

  const density = densityFor(ingredientName);
  const qtyInPriceUnits = convertQuantity(quantity, unit, priceUnit, density);
  if (qtyInPriceUnits === null) {
    const needsDensity =
      UNITS[unit].type !== UNITS[priceUnit].type &&
      UNITS[unit].type !== "count" &&
      UNITS[priceUnit].type !== "count";
    return {
      cost: null,
      error: needsDensity
        ? `no density known for "${ingredientName}" — price it per ${UNITS[unit].type === "weight" ? "kg" : "L"} instead`
        : `can't convert ${unit} to ${priceUnit}`,
    };
  }
  return { cost: qtyInPriceUnits * p, error: null };
}

/**
 * Totals for a whole recipe.
 * @returns {{ lines: Array<{cost, error}>, subtotal, overhead, total, perServing }}
 */
export function recipeCost(ingredients, { servings = 1, overheadPct = 0 } = {}) {
  const lines = (ingredients || []).map((ing) => lineCost(ing));
  const subtotal = lines.reduce((s, l) => s + (l.cost ?? 0), 0);
  const overhead = subtotal * (Number(overheadPct) || 0) / 100;
  const total = subtotal + overhead;
  const perServing = servings > 0 ? total / servings : total;
  return { lines, subtotal, overhead, total, perServing };
}

export function formatINR(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
