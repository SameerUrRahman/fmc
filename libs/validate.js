import { UNITS, PRICE_UNITS } from "./units";

// Returns { ok: true, value } with a cleaned ingredient line,
// or { ok: false, error } describing what's wrong.
export function validateIngredientLine(raw, index = 0) {
  const where = `ingredient ${index + 1}`;
  const ingredientName = String(raw?.ingredientName ?? "").trim();
  if (!ingredientName) return { ok: false, error: `${where}: name is required` };

  const quantity = Number(raw?.quantity);
  if (!Number.isFinite(quantity) || quantity < 0)
    return { ok: false, error: `${where}: quantity must be a non-negative number` };

  const unit = String(raw?.unit ?? "");
  if (!UNITS[unit]) return { ok: false, error: `${where}: unknown unit "${unit}"` };

  const price = Number(raw?.price);
  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: `${where}: price must be a non-negative number` };

  const priceUnit = String(raw?.priceUnit ?? "");
  if (!UNITS[priceUnit])
    return { ok: false, error: `${where}: unknown price unit "${priceUnit}"` };

  const value = { ingredientName, quantity, unit, price, priceUnit };
  if (raw?.knownIngredientId) value.knownIngredientId = raw.knownIngredientId;
  return { ok: true, value };
}

export function validateRecipe(raw) {
  const name = String(raw?.name ?? "").trim();
  if (!name) return { ok: false, error: "recipe name is required" };

  const servings = Number(raw?.servings ?? 1);
  if (!Number.isFinite(servings) || servings < 1)
    return { ok: false, error: "servings must be at least 1" };

  const overheadPct = Number(raw?.overheadPct ?? 0);
  if (!Number.isFinite(overheadPct) || overheadPct < 0 || overheadPct > 500)
    return { ok: false, error: "overhead % must be between 0 and 500" };

  const ingredients = [];
  for (const [i, line] of (raw?.ingredients ?? []).entries()) {
    const res = validateIngredientLine(line, i);
    if (!res.ok) return res;
    ingredients.push(res.value);
  }
  return { ok: true, value: { name, servings, overheadPct, ingredients } };
}

export function validateKnownIngredient(raw) {
  const ingredientName = String(raw?.ingredientName ?? "").trim();
  if (!ingredientName) return { ok: false, error: "ingredient name is required" };

  const price = Number(raw?.price);
  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: "price must be a non-negative number" };

  const priceUnit = String(raw?.priceUnit ?? "kg");
  if (!PRICE_UNITS.includes(priceUnit))
    return { ok: false, error: `price unit must be one of ${PRICE_UNITS.join(", ")}` };

  const source = String(raw?.source ?? "manual");
  return { ok: true, value: { ingredientName, price, priceUnit, source, fetchedAt: new Date() } };
}
