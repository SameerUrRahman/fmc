// Regex-first parser for pasted ingredient lists (blogs, WhatsApp, YT
// descriptions). Handles "2 cups flour", "Maida - 1 katori", "½ tsp haldi",
// "2-3 green chillies", "salt to taste". Lines it can't parse are returned
// with status "unparsed" so the LLM fallback (or the user) can rescue them.
//
// Every line gets a status:
//   ok        — quantity + unit parsed cleanly
//   estimated — something was guessed (pseudo-unit, missing unit, range midpoint)
//   unparsed  — couldn't extract an ingredient; needs LLM or manual entry

import { UNITS } from "./units.js";

const UNICODE_FRACTIONS = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
  "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

// alias (lowercase, no trailing dot) -> canonical key in UNITS
const UNIT_ALIASES = {};
function addAliases(unit, aliases) {
  for (const a of aliases) UNIT_ALIASES[a] = unit;
}
addAliases("g", ["g", "gm", "gms", "gr", "gram", "grams"]);
addAliases("kg", ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"]);
addAliases("oz", ["oz", "ounce", "ounces"]);
addAliases("pound", ["lb", "lbs", "pound", "pounds"]);
addAliases("mL", ["ml", "mls", "milliliter", "milliliters", "millilitre", "millilitres"]);
addAliases("L", ["l", "lt", "ltr", "litre", "litres", "liter", "liters"]);
addAliases("tsp", ["tsp", "tsps", "teaspoon", "teaspoons"]);
addAliases("tbsp", ["tbsp", "tbsps", "tbs", "tblsp", "tablespoon", "tablespoons"]);
addAliases("cup", ["cup", "cups"]);
addAliases("piece", [
  "piece", "pieces", "pc", "pcs", "no", "nos", "unit", "units",
  "clove", "cloves", "stick", "sticks", "slice", "slices",
  "leaf", "leaves", "sprig", "sprigs", "pod", "pods", "egg", "eggs",
]);
addAliases("dozen", ["dozen", "dozens"]);

// Units we can only approximate — parsing succeeds but status = "estimated".
// factor/unit express the guess in a real UNITS key.
const PSEUDO_UNITS = {
  katori: { unit: "mL", factor: 150 },
  katoris: { unit: "mL", factor: 150 },
  glass: { unit: "mL", factor: 250 },
  glasses: { unit: "mL", factor: 250 },
  bowl: { unit: "mL", factor: 300 },
  bowls: { unit: "mL", factor: 300 },
  pinch: { unit: "g", factor: 0.3 },
  pinches: { unit: "g", factor: 0.3 },
  dash: { unit: "mL", factor: 0.6 },
  dashes: { unit: "mL", factor: 0.6 },
  drop: { unit: "mL", factor: 0.05 },
  drops: { unit: "mL", factor: 0.05 },
  handful: { unit: "g", factor: 30 },
  handfuls: { unit: "g", factor: 30 },
  inch: { unit: "piece", factor: 1 },
  packet: { unit: "piece", factor: 1 },
  packets: { unit: "piece", factor: 1 },
  can: { unit: "piece", factor: 1 },
  cans: { unit: "piece", factor: 1 },
  tin: { unit: "piece", factor: 1 },
  tins: { unit: "piece", factor: 1 },
};

const TO_TASTE_RE = /\b(to\s+taste|as\s+(needed|required)|for\s+(frying|garnish(ing)?|tempering|tadka)|optional)\b/i;

// Section headings in pasted recipes ("Garnish", "Rice Ingredients", "For the
// marinade"). Headings that end in ":" are already dropped; these don't.
//
// Matched on the whole line and kept to an explicit keyword list on purpose: a
// heading and a bare ingredient are the same shape ("Garnish" vs "Star anise"),
// so anything looser starts eating real ingredients.
const SECTION_HEAD_RE =
  /^(?:for\s+the\s+.*|(?:the\s+)?(?:ingredients?|marinade|marination|garnish(?:ing)?|topping|seasoning|tempering|tadka|masala\s+paste|dough|batter|filling|stuffing|sauce|dressing|assembly|method|instructions?|directions?|notes?|equipment)\b.*|.*\b(?:ingredients?|marinade|garnish(?:ing)?|topping|seasoning|assembly)\s*)$/i;

// quantity: "2", "2.5", "1/2", "1 1/2", optionally a range "2-3" / "2 to 3"
const QTY_PART = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+)`;
const QTY_RE = new RegExp(
  String.raw`^(${QTY_PART})(?:\s*(?:-|–|—|to)\s*(${QTY_PART}))?\s*`
);

function fractionToNumber(s) {
  s = s.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Map a raw unit word to { unit, factor, estimated } or null. */
export function normalizeUnit(word) {
  if (!word) return null;
  const w = String(word).toLowerCase().replace(/\.+$/, "").trim();
  if (UNIT_ALIASES[w]) return { unit: UNIT_ALIASES[w], factor: 1, estimated: false };
  if (PSEUDO_UNITS[w]) return { ...PSEUDO_UNITS[w], estimated: true };
  return null;
}

function expandUnicodeFractions(s) {
  let out = s;
  for (const [ch, frac] of Object.entries(UNICODE_FRACTIONS)) {
    // "1½" -> "1 1/2"
    out = out.replace(new RegExp(`(\\d)${ch}`, "g"), `$1 ${frac}`);
    out = out.replaceAll(ch, frac);
  }
  return out;
}

const DESCRIPTOR_ONLY_RE = /^[a-z\s,()-]+$/i;

/** Split trailing ", finely chopped" style descriptors into notes. */
function splitTrailingNotes(name) {
  const idx = name.indexOf(",");
  if (idx === -1) return { name: name.trim(), notes: "" };
  const head = name.slice(0, idx).trim();
  const tail = name.slice(idx + 1).trim();
  if (head && tail && !/\d/.test(tail) && DESCRIPTOR_ONLY_RE.test(tail)) {
    return { name: head, notes: tail };
  }
  return { name: name.trim(), notes: "" };
}

function cleanName(name) {
  return name
    .replace(/^of\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.:;,\s-]+$/g, "")
    .trim();
}

/**
 * Try to pull { quantity, unit, rest, estimated } off the front of a string.
 * Returns null if there's no leading quantity.
 */
function parseQtyUnit(s) {
  const m = s.match(QTY_RE);
  if (!m) return null;
  const a = fractionToNumber(m[1]);
  const b = m[2] ? fractionToNumber(m[2]) : null;
  if (a === null) return null;
  let quantity = b !== null ? (a + b) / 2 : a; // range -> midpoint
  let estimated = b !== null;
  let rest = s.slice(m[0].length).trim();

  // optional unit word right after the quantity
  const unitMatch = rest.match(/^([a-zA-Z.]+)\s*/);
  let unit = null;
  let unitWord = null;
  if (unitMatch) {
    const norm = normalizeUnit(unitMatch[1]);
    if (norm) {
      unit = norm.unit;
      unitWord = unitMatch[1];
      quantity *= norm.factor;
      estimated = estimated || norm.estimated;
      rest = rest.slice(unitMatch[0].length).trim();
      // "1 inch piece ginger", "2 cup(s) of milk" -> drop filler words
      rest = rest.replace(/^(piece|pieces|of)\s+/i, "");
    }
  }
  if (!unit) {
    unit = "piece"; // "2 onions" -> 2 piece
    estimated = true;
  }
  return { quantity, unit, rest, estimated, unitWord };
}

/** Parse one line. Returns a draft item or null if the line should be skipped. */
export function parseIngredientLine(rawLine) {
  const raw = rawLine.trim();
  if (!raw) return null;

  // Bullets / numbered-list prefixes ("- ", "* ", "• ", "3) " but not "3 onions").
  // Whitespace is inside the character class, not after it: markdown-converted
  // recipe pages emit "* ▢1 pound chicken", where a space sits *between* two
  // bullet markers. Anchoring on a single run of bullets-then-space left the ▢
  // attached to the quantity and killed every line in the list.
  let line = raw
    .replace(/^[-*•·▢◻☐✓\s]+/, "")
    .replace(/^\d+[.)]\s+(?=\D)/, "")
    .trim();
  if (!line) return null;

  // section headers: "For the marinade:" / short line ending in ":"
  if (/:$/.test(line)) return null;
  // Only ever a heading if there's no quantity on the line — otherwise
  // "1 tbsp italian seasoning" and "2 cups cake topping" get silently dropped.
  if (!/\d/.test(line) && SECTION_HEAD_RE.test(line)) return null;

  // Markdown links -> their text. Recipe sites link half their ingredients to
  // affiliate pages; converted to markdown that becomes "[ghee](https://…)",
  // and the URL would otherwise be read as a parenthetical note.
  line = line.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1");

  line = expandUnicodeFractions(line);

  // parenthetical notes -> notes
  let notes = [];
  line = line
    .replace(/\(([^)]*)\)/g, (_, inner) => {
      if (inner.trim()) notes.push(inner.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  const base = { raw, notes: "" };

  // "salt to taste" / "oil for frying" — negligible cost, qty 0, flagged
  if (TO_TASTE_RE.test(line)) {
    const stripped = line.replace(TO_TASTE_RE, " ").replace(/\s+/g, " ").trim();

    // "2 tablespoons ghee optional" is quantified — only the *word* is vague.
    // Falling through to the qty-0 branch would both throw the real quantity
    // away and leave "2 tablespoons ghee" as the ingredient name, which then
    // matches nothing in the price book.
    const quantified = parseQtyUnit(stripped);
    if (quantified && quantified.rest) {
      const { name: qName, notes: qTrailing } = splitTrailingNotes(quantified.rest);
      const ingredientName = cleanName(qName);
      if (ingredientName) {
        if (qTrailing) notes.push(qTrailing);
        return {
          ...base,
          ingredientName,
          quantity: round(quantified.quantity),
          unit: quantified.unit,
          notes: [line.match(TO_TASTE_RE)[0], ...notes].join("; "),
          status: "estimated",
        };
      }
    }

    const name = cleanName(stripped);
    if (!name) return { ...base, ingredientName: "", quantity: 0, unit: "g", status: "unparsed" };
    return {
      ...base,
      ingredientName: name,
      quantity: 0,
      unit: "g",
      notes: [line.match(TO_TASTE_RE)[0], ...notes].join("; "),
      status: "estimated",
    };
  }

  // "a pinch of hing" / "an inch of ginger" -> "1 pinch of hing"
  const article = line.match(/^(?:a|an|one)\s+([a-zA-Z]+)/i);
  if (article && normalizeUnit(article[1])) {
    line = line.replace(/^(?:a|an|one)\s+/i, "1 ");
  }

  // Form A: "2 cups flour" — quantity first
  let qtyFirst = parseQtyUnit(line);

  // "8 cloves" / "4 bay leaves" — the unit word IS the ingredient. Without this
  // the unit alias eats the only noun on the line and nothing is left to name,
  // so the line dies as unparsed. Only count words qualify: "2 cups" or "500 g"
  // with nothing after it is a missing ingredient, not an ingredient called
  // "cups". Quantity is re-read from the line because the unit factor has
  // already been applied to it (a "dozen" would otherwise come back as 12).
  if (qtyFirst && !qtyFirst.rest && qtyFirst.unitWord && UNITS[qtyFirst.unit]?.type === "count") {
    const bare = parseQtyUnit(line.replace(/^(\S+)\s+\S+/, "$1"));
    if (bare) {
      return {
        ...base,
        ingredientName: cleanName(qtyFirst.unitWord),
        quantity: round(bare.quantity),
        unit: "piece",
        notes: notes.join("; "),
        status: "estimated",
      };
    }
  }

  if (qtyFirst && qtyFirst.rest) {
    const { name, notes: trailing } = splitTrailingNotes(qtyFirst.rest);
    const ingredientName = cleanName(name);
    if (ingredientName) {
      if (trailing) notes.push(trailing);
      return {
        ...base,
        ingredientName,
        quantity: round(qtyFirst.quantity),
        unit: qtyFirst.unit,
        notes: notes.join("; "),
        status: qtyFirst.estimated ? "estimated" : "ok",
      };
    }
  }

  // Form B: "Maida - 2 cups" / "Sugar: 1/2 cup" — name first
  const nameFirst = line.match(/^([^:–—-]+?)\s*[:–—-]\s*(.+)$/);
  if (nameFirst) {
    const qty = parseQtyUnit(nameFirst[2].trim());
    if (qty) {
      const ingredientName = cleanName(splitTrailingNotes(nameFirst[1]).name);
      if (ingredientName) {
        if (qty.rest) notes.push(qty.rest); // leftover text after qty/unit
        return {
          ...base,
          ingredientName,
          quantity: round(qty.quantity),
          unit: qty.unit,
          notes: notes.join("; "),
          status: qty.estimated ? "estimated" : "ok",
        };
      }
    }
  }

  // Form C: bare short name ("Bay leaf") — assume 1 piece
  const words = line.split(/\s+/);
  if (words.length <= 4 && !/\d/.test(line)) {
    const { name, notes: trailing } = splitTrailingNotes(line);
    const ingredientName = cleanName(name);
    if (ingredientName) {
      if (trailing) notes.push(trailing);
      return {
        ...base,
        ingredientName,
        quantity: 1,
        unit: "piece",
        notes: notes.join("; "),
        status: "estimated",
      };
    }
  }

  // Give up — likely an instruction sentence or something exotic
  return { ...base, ingredientName: "", quantity: 0, unit: "g", status: "unparsed" };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Parse a pasted blob of text into draft ingredient items.
 * Skips headers/empty lines; keeps unparsed lines for LLM/manual rescue.
 */
export function parseIngredientText(text) {
  const items = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const item = parseIngredientLine(rawLine);
    if (item) items.push(item);
  }
  return items;
}

// sanity check: every unit the parser can emit must exist in the unit engine
for (const u of [...Object.values(UNIT_ALIASES), ...Object.values(PSEUDO_UNITS).map((p) => p.unit)]) {
  if (!UNITS[u]) throw new Error(`ingredientParser: unknown unit "${u}"`);
}
