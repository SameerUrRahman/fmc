// Item 9: recipe import from a URL.
//
// Everything here is pure — HTML in, ingredient lines out — so the whole
// extraction ladder is testable against saved fixtures with no network.
// The route (app/api/recipes/import-url/route.js) owns fetching; this file
// owns deciding what a page says.
//
// The ladder, best evidence first:
//   json-ld    schema.org/Recipe in <script type="application/ld+json">
//   microdata  itemprop="recipeIngredient" (older sites, same vocabulary)
//   heuristic  <li> under a heading that says "Ingredients"
//   (llm)      the route's last resort — see pickLlmCandidates()
//
// The output is deliberately *raw text lines*, not parsed ingredients: they go
// straight into the existing parseIngredientText + fuzzy-match pipeline, which
// already knows Hinglish units, ranges and "to taste". A URL is a new input
// channel, not a second parser.

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", middot: "·", times: "×", deg: "°",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  frac12: "½", frac13: "⅓", frac14: "¼", frac23: "⅔", frac34: "¾",
};

/** Decode the HTML entities that actually show up in ingredient text. */
export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Drop <script>/<style>/<template> and their contents outright. */
function stripInvisible(html) {
  return String(html ?? "").replace(
    /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " "
  );
}

/**
 * Flatten an HTML fragment to text. Block-ish tags become newlines so a list
 * survives as one item per line; everything else collapses to spaces.
 */
export function htmlToText(html) {
  return decodeEntities(
    stripInvisible(html)
      .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div|\/tr|\/td)\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Tidy candidate ingredient lines: strip markup, drop empties and obvious
 * non-ingredients, de-duplicate, and cap the count.
 *
 * The cap is not cosmetic — an unbounded list from a hostile page becomes an
 * unbounded LLM prompt downstream on a no-auth public instance.
 */
export function cleanIngredientLines(lines, { max = 80 } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of lines ?? []) {
    const text = htmlToText(String(raw ?? "")).replace(/\s*\n\s*/g, " ").trim();
    if (text.length < 2 || text.length > 200) continue;
    // "Ingredients", "For the tempering:" — headings, not ingredients
    if (/^(ingredients?|for the .{0,40}|method|instructions?|directions?)\s*:?$/i.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** "4 servings" / ["4"] / 4 / {value: 4} -> 4. Null when it isn't a count. */
export function parseServings(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === null || first === undefined) return null;
  if (typeof first === "object") return parseServings(first.value ?? first["@value"] ?? null);
  const m = String(first).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/** schema.org fields are routinely string | string[] | {@value}. Flatten. */
function asText(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === null || first === undefined) return "";
  if (typeof first === "object") return asText(first["@value"] ?? first.name ?? "");
  return htmlToText(String(first)).replace(/\s*\n\s*/g, " ").trim();
}

function typesOf(node) {
  const t = node?.["@type"];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x).toLowerCase());
}

/** Walk any JSON-LD shape (@graph, arrays, nesting) collecting Recipe nodes. */
function collectRecipeNodes(value, found = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return found;
  if (Array.isArray(value)) {
    for (const v of value) collectRecipeNodes(v, found, depth + 1);
    return found;
  }
  if (typesOf(value).includes("recipe")) found.push(value);
  for (const v of Object.values(value)) {
    if (v && typeof v === "object") collectRecipeNodes(v, found, depth + 1);
  }
  return found;
}

/**
 * Every parseable <script type="application/ld+json"> payload on the page.
 * One malformed block must not lose the others — sites commonly ship several,
 * and a plugin emitting broken JSON is not the recipe block's fault.
 */
export function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html ?? "")) !== null) {
    const body = m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // ignore malformed blocks
    }
  }
  return blocks;
}

/**
 * The schema.org/Recipe on a page, if there is one.
 * @returns {{title:string, ingredients:string[], servings:number|null, author:string}|null}
 */
export function extractJsonLdRecipe(html) {
  for (const block of jsonLdBlocks(html)) {
    for (const node of collectRecipeNodes(block)) {
      const raw = node.recipeIngredient ?? node.ingredients;
      const ingredients = cleanIngredientLines(Array.isArray(raw) ? raw : raw ? [raw] : []);
      if (ingredients.length === 0) continue;
      return {
        title: asText(node.name),
        ingredients,
        servings: parseServings(node.recipeYield),
        author: asText(node.author),
      };
    }
  }
  return null;
}

/**
 * Microdata fallback: itemprop="recipeIngredient" (or the pre-2017
 * "ingredients"). Matches to the element's own closing tag, which is right for
 * the shape sites actually use (`<li itemprop=…>2 cups flour</li>`) and would
 * truncate on a same-tag nesting — acceptable for a fallback, and the heuristic
 * layer below catches the leftovers.
 */
export function extractMicrodataIngredients(html) {
  const re = /<(\w+)\b[^>]*itemprop\s*=\s*["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/\1\s*>/gi;
  const lines = [];
  let m;
  while ((m = re.exec(html ?? "")) !== null) lines.push(m[2]);
  return cleanIngredientLines(lines);
}

/**
 * Last structural resort: list items sitting under a heading that says
 * "Ingredients", or inside a container whose class says so.
 *
 * Requires two or more lines — a single <li> under such a heading is more
 * likely a stray nav item than a recipe.
 */
export function extractHeuristicIngredients(html) {
  const page = stripInvisible(html ?? "");

  const headingRe = /<h([1-6])\b[^>]*>([\s\S]{0,200}?)<\/h\1\s*>/gi;
  let m;
  while ((m = headingRe.exec(page)) !== null) {
    if (!/ingredient/i.test(htmlToText(m[2]))) continue;
    const rest = page.slice(headingRe.lastIndex);
    // stop at the next heading of any level — that section is over
    const end = rest.search(/<h[1-6]\b/i);
    const section = end === -1 ? rest : rest.slice(0, end);
    const lines = cleanIngredientLines(
      [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)].map((li) => li[1])
    );
    if (lines.length >= 2) return lines;
  }

  const classed = cleanIngredientLines(
    [...page.matchAll(/<li\b[^>]*class\s*=\s*["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li\s*>/gi)]
      .map((li) => li[1])
  );
  return classed.length >= 2 ? classed : [];
}

/** The page <title>, minus the site-name suffix most CMSes append. */
export function extractPageTitle(html) {
  const m = String(html ?? "").match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!m) return "";
  return htmlToText(m[1]).split("\n")[0].split(/\s+[|–—-]\s+/)[0].trim().slice(0, 120);
}

/**
 * Run the structural ladder over a page.
 * @returns {{title:string, ingredients:string[], servings:number|null, via:string}}
 *          `ingredients` empty means nothing structural was found — the caller
 *          decides whether to spend an LLM call on it.
 */
export function extractRecipeFromHtml(html) {
  const pageTitle = extractPageTitle(html);

  const jsonLd = extractJsonLdRecipe(html);
  if (jsonLd) {
    return {
      title: jsonLd.title || pageTitle,
      ingredients: jsonLd.ingredients,
      servings: jsonLd.servings,
      via: "json-ld",
    };
  }

  const micro = extractMicrodataIngredients(html);
  if (micro.length > 0) {
    return { title: pageTitle, ingredients: micro, servings: null, via: "microdata" };
  }

  const heuristic = extractHeuristicIngredients(html);
  if (heuristic.length > 0) {
    return { title: pageTitle, ingredients: heuristic, servings: null, via: "heuristic" };
  }

  return { title: pageTitle, ingredients: [], servings: null, via: "none" };
}

// Unit words worth keeping a line for when nothing structural was found. Kept
// deliberately short: this is a filter to shrink an LLM prompt, not a parser.
const UNIT_HINT =
  /\b(g|gm|gms|kg|ml|l|ltr|litre|liter|tsp|tbsp|cup|cups|piece|pieces|pcs|katori|glass|bowl|pinch|handful|clove|cloves|sprig|inch|packet|dozen|slice|slices)\b/i;

/**
 * Shrink a whole page to the lines plausibly worth an LLM look.
 *
 * The LLM's job here is *selection*, not extraction: it says which of these
 * raw lines are ingredients, and those lines then go through the normal regex
 * parser like any pasted text. Sending a whole article instead would cost
 * thousands of tokens per import against a 100k/day budget (see roadmap item
 * 5, where output tokens dominate), so only lines carrying a quantity or a
 * unit word are offered.
 */
export function pickLlmCandidates(html, { max = 60 } = {}) {
  const lines = htmlToText(html)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 120)
    .filter((l) => /\d|[½⅓⅔¼¾⅛]/.test(l) || UNIT_HINT.test(l))
    // dates, prices, ratings, cook times — numeric but never ingredients
    .filter((l) => !/^(₹|\$|rs\.?\s*\d)/i.test(l))
    .filter((l) => !/\b(comments?|rating|stars?|calories|kcal|prep time|cook time|total time|published|updated)\b/i.test(l));
  return cleanIngredientLines(lines, { max });
}

// ---------------------------------------------------------------------------
// URL safety. The live instance has no auth, so /api/recipes/import-url is an
// open fetch primitive: without these checks anyone could point it at
// 169.254.169.254 or a localhost admin port and read the response back out of
// the error message. Pure and exported so the rules are tested, not asserted.
// ---------------------------------------------------------------------------

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa"];

/** Dotted-quad -> 32-bit int, or null if it isn't one. */
function ipv4ToInt(host) {
  const m = String(host).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** True for any address a public fetch has no business reaching. */
export function isBlockedAddress(address) {
  const addr = String(address ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!addr) return true;

  // IPv4-mapped/compatible IPv6 (::ffff:127.0.0.1) reduces to the v4 rules
  const mapped = addr.match(/^::(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return isBlockedAddress(mapped[1]);

  const v4 = ipv4ToInt(addr);
  if (v4 !== null) {
    const inNet = (cidrBase, bits) => (v4 >>> (32 - bits)) === (ipv4ToInt(cidrBase) >>> (32 - bits));
    return (
      inNet("0.0.0.0", 8) ||        // this network
      inNet("10.0.0.0", 8) ||       // private
      inNet("100.64.0.0", 10) ||    // CGNAT
      inNet("127.0.0.0", 8) ||      // loopback
      inNet("169.254.0.0", 16) ||   // link-local, incl. cloud metadata
      inNet("172.16.0.0", 12) ||    // private
      inNet("192.0.0.0", 24) ||     // IETF protocol assignments
      inNet("192.168.0.0", 16) ||   // private
      inNet("198.18.0.0", 15) ||    // benchmarking
      inNet("224.0.0.0", 4) ||      // multicast
      inNet("240.0.0.0", 4)         // reserved / broadcast
    );
  }

  if (addr.includes(":")) {
    if (addr === "::" || addr === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true;          // unique-local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(addr)) return true;          // link-local fe80::/10
    return false;
  }

  return false; // not an address at all — hostname rules handle it
}

/** True for hostnames that don't need a DNS lookup to be obviously internal. */
export function isBlockedHostname(hostname) {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost") return true;
  if (!host.includes(".") && !host.includes(":")) return true; // bare intranet name
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return isBlockedAddress(host);
}

/**
 * Validate and normalize a user-supplied recipe URL.
 * @returns {{ok:true, url:URL}|{ok:false, error:string}}
 */
export function normalizeRecipeUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "paste a recipe URL first" };
  if (raw.length > 2000) return { ok: false, error: "that URL is too long" };

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "that doesn't look like a URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "only http and https URLs can be imported" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URLs with embedded credentials aren't allowed" };
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, error: "that address is on a private network" };
  }
  return { ok: true, url };
}
