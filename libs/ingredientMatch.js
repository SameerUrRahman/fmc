// Fuzzy-match parsed ingredient names against the KnownIngredients price
// book: normalize -> translate Hindi/Hinglish aliases -> Dice-coefficient
// bigram similarity. Also consults per-ingredient `aliases` saved on the
// price book documents, so user corrections make matching smarter over time.

// Hinglish / regional name -> common English price-book name.
// Multi-word keys are matched before single-word ones.
export const NAME_ALIASES = {
  "kasuri methi": "dried fenugreek leaves",
  "hara dhania": "coriander leaves",
  "lal mirch": "red chilli powder",
  "hari mirch": "green chilli",
  "kali mirch": "black pepper",
  "shimla mirch": "capsicum",
  "tej patta": "bay leaf",
  maida: "all purpose flour",
  atta: "wheat flour",
  dahi: "curd",
  jeera: "cumin",
  haldi: "turmeric",
  dhania: "coriander",
  kothmir: "coriander leaves",
  cilantro: "coriander leaves",
  mirchi: "chilli",
  adrak: "ginger",
  lehsun: "garlic",
  lahsun: "garlic",
  pyaz: "onion",
  pyaaz: "onion",
  kanda: "onion",
  tamatar: "tomato",
  aloo: "potato",
  batata: "potato",
  gobi: "cauliflower",
  besan: "gram flour",
  suji: "semolina",
  sooji: "semolina",
  rava: "semolina",
  chawal: "rice",
  chini: "sugar",
  cheeni: "sugar",
  shakkar: "sugar",
  namak: "salt",
  kaju: "cashew",
  badam: "almond",
  kishmish: "raisins",
  elaichi: "cardamom",
  dalchini: "cinnamon",
  laung: "clove",
  methi: "fenugreek",
  sarson: "mustard",
  rai: "mustard seeds",
  hing: "asafoetida",
  imli: "tamarind",
  gud: "jaggery",
  til: "sesame seeds",
  makhan: "butter",
  doodh: "milk",
  malai: "cream",
  anda: "egg",
  ande: "eggs",
  palak: "spinach",
  matar: "peas",
  bhindi: "okra",
  baingan: "brinjal",
  nimbu: "lemon",
  nariyal: "coconut",
  pudina: "mint",
};

// Prep-style words that don't change what the ingredient *is*.
const DESCRIPTORS = new Set([
  "fresh", "freshly", "finely", "roughly", "thinly", "thickly", "coarsely",
  "chopped", "sliced", "diced", "grated", "minced", "crushed", "ground",
  "boiled", "peeled", "washed", "soaked", "roasted", "toasted", "melted",
  "softened", "beaten", "whisked", "sifted", "cubed", "julienned", "shredded",
  "large", "medium", "small", "big", "ripe", "raw", "whole", "halved",
  "heaped", "heaping", "level", "packed", "tightly", "loosely", "optional",
  "cut", "into", "pieces", "cubes", "chunks", "a", "an", "the", "some", "few",
]);

export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !DESCRIPTORS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ")
    .trim();
}

/** Apply NAME_ALIASES to a normalized name (whole-phrase or per-word). */
export function applyAliases(normalized) {
  if (NAME_ALIASES[normalized]) return NAME_ALIASES[normalized];
  let out = normalized;
  // multi-word aliases first so "kali mirch" wins over "mirch"-ish words
  const keys = Object.keys(NAME_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (out.includes(key) && new RegExp(`\\b${key}\\b`).test(out)) {
      out = out.replace(new RegExp(`\\b${key}\\b`), NAME_ALIASES[key]);
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function bigrams(s) {
  const grams = new Map();
  const str = ` ${s} `; // pad so first/last chars count
  for (let i = 0; i < str.length - 1; i++) {
    const g = str.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return grams;
}

/** Dice coefficient over character bigrams, 0..1. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    total += n;
    if (gb.has(g)) overlap += Math.min(n, gb.get(g));
  }
  for (const [, n] of gb) total += n;
  return (2 * overlap) / total;
}

function scoreAgainst(candidates, target) {
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    let s = similarity(c, target);
    // containment boost: "onion" vs "red onion"
    if (s < 0.85 && (c.includes(target) || target.includes(c))) {
      s = Math.max(s, 0.85 - Math.abs(c.length - target.length) * 0.02);
    }
    if (s > best) best = s;
  }
  return best;
}

/**
 * Find the best price-book match for a parsed ingredient name.
 * @param {string} name        raw parsed name ("hari mirch, chopped")
 * @param {Array}  knowns      KnownIngredients docs (may carry .aliases)
 * @returns {{ known: object|null, score: number }}
 */
export function matchKnownIngredient(name, knowns) {
  const norm = normalizeName(name);
  if (!norm) return { known: null, score: 0 };
  const translated = applyAliases(norm);
  const targets = norm === translated ? [norm] : [norm, translated];

  let best = { known: null, score: 0 };
  for (const known of knowns || []) {
    const candidates = [
      normalizeName(known.ingredientName),
      ...(known.aliases || []).map(normalizeName),
    ];
    for (const target of targets) {
      const s = scoreAgainst(candidates, target);
      if (s > best.score) best = { known, score: s };
    }
  }
  return best;
}

/** Threshold above which we auto-link a match. */
export const MATCH_THRESHOLD = 0.6;
