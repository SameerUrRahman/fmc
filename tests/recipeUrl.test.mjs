// Item 9: URL import.
//
// Two things are worth pinning down here. First the extraction ladder, because
// real recipe pages emit schema.org in every shape the spec allows (@graph,
// arrays of types, a bare string where an array is documented) and every
// unhandled shape is a silent "no ingredients found". Second the URL rules, because
// this feature adds an unauthenticated outbound fetch to a public instance and
// the blocklist is the only thing standing between it and 169.254.169.254.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  htmlToText,
  cleanIngredientLines,
  parseServings,
  extractJsonLdRecipe,
  extractMicrodataIngredients,
  extractHeuristicIngredients,
  extractPageTitle,
  extractRecipeFromHtml,
  pickLlmCandidates,
  isBlockedAddress,
  isBlockedHostname,
  normalizeRecipeUrl,
} from "../libs/recipeUrl.js";

const ldPage = (json, extra = "") => `<!doctype html>
<html><head><title>Paneer Butter Masala | Cook With Me</title>
<script type="application/ld+json">${JSON.stringify(json)}</script>
</head><body>${extra}</body></html>`;

test("decodeEntities handles named, decimal and hex references", () => {
  assert.equal(decodeEntities("salt &amp; pepper"), "salt & pepper");
  assert.equal(decodeEntities("&frac12; tsp haldi"), "½ tsp haldi");
  assert.equal(decodeEntities("chilli&#39;s"), "chilli's");
  assert.equal(decodeEntities("chilli&#x27;s"), "chilli's");
  // an unknown entity is left alone rather than silently eaten
  assert.equal(decodeEntities("a &notreal; b"), "a &notreal; b");
});

test("htmlToText drops scripts and keeps one line per list item", () => {
  const text = htmlToText(
    "<ul><li>2 cups maida</li><li>1 tsp <b>haldi</b></li></ul><script>var x = '3 kg gold';</script>"
  );
  assert.deepEqual(text.split("\n").filter(Boolean), ["2 cups maida", "1 tsp haldi"]);
  assert.ok(!text.includes("gold"), "script contents must never reach the parser");
});

test("cleanIngredientLines strips markup, headings, duplicates — and caps", () => {
  const lines = cleanIngredientLines([
    "  <a href='https://amzn.to/x'>2 cups maida</a>  ",
    "Ingredients",
    "For the tempering:",
    "2 cups maida", // duplicate of the first once markup is stripped
    "",
    "x".repeat(300),
  ]);
  assert.deepEqual(lines, ["2 cups maida"]);
  assert.equal(cleanIngredientLines(Array(200).fill().map((_, i) => `${i} g salt`)).length, 80);
});

test("parseServings reads the shapes recipeYield actually ships in", () => {
  assert.equal(parseServings("4 servings"), 4);
  assert.equal(parseServings(["6", "6 people"]), 6);
  assert.equal(parseServings(4), 4);
  assert.equal(parseServings({ "@value": "3" }), 3);
  assert.equal(parseServings("a loaf"), null);
  assert.equal(parseServings(undefined), null);
  // implausible counts are rejected rather than blindly applied to a recipe
  assert.equal(parseServings("1000"), null);
});

test("extractJsonLdRecipe reads a plain Recipe node", () => {
  const found = extractJsonLdRecipe(
    ldPage({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Paneer Butter Masala",
      recipeYield: "4 servings",
      recipeIngredient: ["250 g paneer", "2 tbsp butter", "1/2 tsp haldi"],
    })
  );
  assert.equal(found.title, "Paneer Butter Masala");
  assert.equal(found.servings, 4);
  assert.deepEqual(found.ingredients, ["250 g paneer", "2 tbsp butter", "1/2 tsp haldi"]);
});

test("extractJsonLdRecipe digs the Recipe out of an @graph", () => {
  const found = extractJsonLdRecipe(
    ldPage({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Cook With Me" },
        { "@type": "BreadcrumbList", itemListElement: [] },
        { "@type": ["Recipe", "NewsArticle"], name: "Dal Tadka", recipeIngredient: ["1 cup toor dal", "2 tomatoes"] },
      ],
    })
  );
  assert.equal(found.title, "Dal Tadka");
  assert.deepEqual(found.ingredients, ["1 cup toor dal", "2 tomatoes"]);
});

test("extractJsonLdRecipe survives a broken sibling block and entity-laden lines", () => {
  const html = `<html><head>
    <script type="application/ld+json">{ this is not json }</script>
    <script type="application/ld+json">${JSON.stringify([
      { "@type": "Organization", name: "Ads Inc" },
      { "@type": "Recipe", name: "Aloo &amp; Gobi", recipeIngredient: ["&frac12; tsp jeera", "2 aloo"] },
    ])}</script></head><body></body></html>`;
  const found = extractJsonLdRecipe(html);
  assert.equal(found.title, "Aloo & Gobi");
  assert.deepEqual(found.ingredients, ["½ tsp jeera", "2 aloo"]);
});

test("extractJsonLdRecipe skips a Recipe node with no ingredients", () => {
  // recipe roundups carry Recipe stubs with only a name — falling for the first
  // one would import an empty list and report success
  const html = ldPage({
    "@graph": [
      { "@type": "Recipe", name: "Related: Chole" },
      { "@type": "Recipe", name: "Rajma", recipeIngredient: ["1 cup rajma"] },
    ],
  });
  assert.equal(extractJsonLdRecipe(html).title, "Rajma");
});

test("microdata is the fallback when there is no JSON-LD", () => {
  const html = `<ul>
    <li itemprop="recipeIngredient">2 cups <span>maida</span></li>
    <li itemprop="ingredients">1 tsp namak</li>
  </ul>`;
  assert.deepEqual(extractMicrodataIngredients(html), ["2 cups maida", "1 tsp namak"]);
});

test("the heuristic takes list items under an Ingredients heading, and stops at the next heading", () => {
  const html = `<h2>Ingredients</h2><ul><li>1 kg chicken</li><li>2 onions</li></ul>
    <h2>Method</h2><ul><li>Heat the oil</li><li>Add the onions</li></ul>`;
  assert.deepEqual(extractHeuristicIngredients(html), ["1 kg chicken", "2 onions"]);
});

test("the heuristic refuses a single stray list item", () => {
  assert.deepEqual(extractHeuristicIngredients("<h2>Ingredients</h2><ul><li>Jump to recipe</li></ul>"), []);
});

test("extractPageTitle drops the site-name suffix", () => {
  assert.equal(
    extractPageTitle("<title>Paneer Butter Masala | Cook With Me</title>"),
    "Paneer Butter Masala"
  );
});

test("extractRecipeFromHtml prefers JSON-LD over the page's visible list", () => {
  const html = ldPage(
    { "@type": "Recipe", name: "Dal", recipeIngredient: ["1 cup dal"] },
    "<h2>Ingredients</h2><ul><li>3 cups sugar</li><li>4 cups salt</li></ul>"
  );
  const found = extractRecipeFromHtml(html);
  assert.equal(found.via, "json-ld");
  assert.deepEqual(found.ingredients, ["1 cup dal"]);
});

test("extractRecipeFromHtml reports 'none' rather than inventing lines", () => {
  const found = extractRecipeFromHtml("<html><head><title>About us</title></head><body><p>Hello</p></body></html>");
  assert.equal(found.via, "none");
  assert.deepEqual(found.ingredients, []);
  assert.equal(found.title, "About us");
});

test("pickLlmCandidates keeps quantity lines and drops the article around them", () => {
  const html = `<body>
    <p>Updated 12 March 2026 · 45 comments</p>
    <p>Prep time 15 mins</p>
    <p>My grandmother made this every winter and the smell still takes me back.</p>
    <p>2 cups maida</p>
    <p>½ tsp haldi</p>
    <p>a handful of coriander</p>
    <p>₹250 for the paneer</p>
  </body>`;
  const picked = pickLlmCandidates(html);
  assert.deepEqual(picked, ["2 cups maida", "½ tsp haldi", "a handful of coriander"]);
});

test("isBlockedAddress covers loopback, private, link-local and their v6 spellings", () => {
  for (const addr of [
    "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.4.4", "172.31.255.255",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255",
    "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedAddress(addr), true, `${addr} must be blocked`);
  }
  for (const addr of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
    assert.equal(isBlockedAddress(addr), false, `${addr} must be allowed`);
  }
});

test("isBlockedHostname blocks bare and internal names", () => {
  for (const host of ["localhost", "router", "printer.local", "db.internal", "metadata.google.internal"]) {
    assert.equal(isBlockedHostname(host), true, `${host} must be blocked`);
  }
  assert.equal(isBlockedHostname("www.example.com"), false);
  assert.equal(isBlockedHostname("example.com."), false); // trailing dot is still public
});

test("normalizeRecipeUrl accepts real links and rejects the dangerous shapes", () => {
  const ok = normalizeRecipeUrl("hebbarskitchen.com/paneer-butter-masala/");
  assert.equal(ok.ok, true);
  assert.equal(ok.url.protocol, "https:"); // scheme filled in
  assert.equal(normalizeRecipeUrl("https://ok.com/x?a=1").ok, true);

  for (const bad of [
    "",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://127.0.0.1:27017/",
    "http://169.254.169.254/latest/meta-data/",
    "http://user:pw@example.com/",
    "not a url at all",
  ]) {
    assert.equal(normalizeRecipeUrl(bad).ok, false, `${bad} must be rejected`);
  }
});
