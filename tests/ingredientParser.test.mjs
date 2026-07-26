// Parser regression suite.
//
// Runs on node:test — no test framework dependency. The libs are ESM-in-.js
// with no "type": "module" in package.json, which plain node would normally
// read as CommonJS; Node >=22.7 detects the module syntax and reparses, so
// these import directly with no build step. (That's why the .mjs data scripts
// still can't import them — they'd hit the same reparse, but the scripts
// predate it. See the schema-duplication note in ROADMAP.md.)
//
// Every case below is either a documented behaviour from the parser's own
// header comment or a bug this suite was written to keep fixed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIngredientLine, parseIngredientText } from "../libs/ingredientParser.js";

/** Assert a line parses to a given name/quantity/unit. */
function expectLine(input, { name, quantity, unit, status }) {
  const r = parseIngredientLine(input);
  assert.ok(r, `expected ${JSON.stringify(input)} to parse, got null`);
  assert.notEqual(r.status, "unparsed", `${JSON.stringify(input)} was unparsed`);
  assert.equal(r.ingredientName, name, `name for ${JSON.stringify(input)}`);
  assert.equal(r.quantity, quantity, `quantity for ${JSON.stringify(input)}`);
  assert.equal(r.unit, unit, `unit for ${JSON.stringify(input)}`);
  if (status) assert.equal(r.status, status, `status for ${JSON.stringify(input)}`);
}

/** Assert a line is dropped entirely (heading, blank, bullet-only). */
function expectSkipped(input) {
  const r = parseIngredientLine(input);
  assert.ok(
    r === null || r.status === "unparsed",
    `expected ${JSON.stringify(input)} to be skipped, got ${JSON.stringify(r)}`
  );
}

test("quantity-first lines", () => {
  expectLine("2 cups flour", { name: "flour", quantity: 2, unit: "cup", status: "ok" });
  expectLine("500 g paneer", { name: "paneer", quantity: 500, unit: "g", status: "ok" });
  expectLine("½ tsp haldi", { name: "haldi", quantity: 0.5, unit: "tsp", status: "ok" });
  expectLine("1½ tablespoons kosher salt", { name: "kosher salt", quantity: 1.5, unit: "tbsp" });
  expectLine("2½ cups basmati rice", { name: "basmati rice", quantity: 2.5, unit: "cup" });
});

test("name-first lines", () => {
  expectLine("Sugar: 1/2 cup", { name: "Sugar", quantity: 0.5, unit: "cup" });
  expectLine("Maida - 1 katori", { name: "Maida", quantity: 150, unit: "mL", status: "estimated" });
});

test("ranges take the midpoint and are flagged estimated", () => {
  expectLine("2-3 green chillies", {
    name: "green chillies", quantity: 2.5, unit: "piece", status: "estimated",
  });
  expectLine("2 to 3 teaspoons biryani masala", {
    name: "biryani masala", quantity: 2.5, unit: "tsp", status: "estimated",
  });
});

test("countable items default to piece", () => {
  expectLine("2 onions", { name: "onions", quantity: 2, unit: "piece", status: "estimated" });
  expectLine("12 eggs", { name: "eggs", quantity: 12, unit: "piece" });
  expectLine("Bay leaf", { name: "Bay leaf", quantity: 1, unit: "piece", status: "estimated" });
  // "dozen" is a real unit; units.js converts it, so don't flatten it to 12 piece
  expectLine("1 dozen eggs", { name: "eggs", quantity: 1, unit: "dozen" });
});

test("articles and pseudo-units", () => {
  expectLine("a pinch of hing", { name: "hing", quantity: 0.3, unit: "g", status: "estimated" });
  expectLine("1 inch piece ginger", { name: "ginger", quantity: 1, unit: "piece" });
});

test("vague-amount lines", () => {
  expectLine("salt to taste", { name: "salt", quantity: 0, unit: "g", status: "estimated" });
  expectLine("oil for frying", { name: "oil", quantity: 0, unit: "g", status: "estimated" });

  // Regression: a quantified line whose only vague part is the WORD "optional"
  // kept quantity 0 and an ingredient name of "2 tablespoons ghee", which then
  // fuzzy-matched nothing in the price book.
  expectLine("2 tablespoons ghee optional", {
    name: "ghee", quantity: 2, unit: "tbsp", status: "estimated",
  });
});

test("bullets and checkbox glyphs are stripped", () => {
  expectLine("- 1 cup milk, warmed", { name: "milk", quantity: 1, unit: "cup" });
  expectLine("• 2 cups flour", { name: "flour", quantity: 2, unit: "cup" });

  // Regression: the strip was /^[-*•·▢◻☐✓]+\s*/ — bullets THEN whitespace. A
  // markdown-converted recipe page emits "* ▢1 pound chicken", with a space
  // BETWEEN two markers, so the ▢ stayed glued to the quantity and the line
  // died. This single character killed 22 of 27 lines in a real paste.
  expectLine("* ▢1 pound boneless skinless chicken thighs", {
    name: "boneless skinless chicken thighs", quantity: 1, unit: "pound",
  });
  expectLine("* ▢¾ cup plain yogurt", { name: "plain yogurt", quantity: 0.75, unit: "cup" });
});

test("markdown links reduce to their text", () => {
  // Recipe sites link ingredients to affiliate pages; the URL would otherwise
  // be captured as a parenthetical note and "[ghee]" kept as the name.
  expectLine("1 tablespoon [ginger paste](https://ministryofcurry.com/ginger-paste/)", {
    name: "ginger paste", quantity: 1, unit: "tbsp",
  });
  expectLine("* ▢½ teaspoon [ground turmeric](https://linksta.io/9067523e)", {
    name: "ground turmeric", quantity: 0.5, unit: "tsp",
  });
});

test("a unit word can be the ingredient", () => {
  // "cloves" is a piece-alias, so the alias ate the only noun and left nothing
  // to name. Count units with no remainder now name themselves.
  expectLine("8 cloves", { name: "cloves", quantity: 8, unit: "piece", status: "estimated" });
  expectLine("* ▢2 [bay leaves - tamal patra](https://amzn.to/36kuN6C)", {
    name: "bay leaves - tamal patra", quantity: 2, unit: "piece",
  });
  // but a real ingredient after the unit still wins
  expectLine("3 cloves garlic", { name: "garlic", quantity: 3, unit: "piece" });
});

test("section headings are dropped", () => {
  expectSkipped("For the marinade:");
  expectSkipped("For the marinade");
  expectSkipped("Garnish");
  expectSkipped("Rice Ingredients");
  expectSkipped("Ingredients");
  expectSkipped("");
  expectSkipped("*");
});

test("heading detection never eats a quantified line", () => {
  // The heading list matches words like "seasoning" and "topping" that also end
  // real ingredient lines, so it only applies to lines with no digits.
  expectLine("1 tbsp italian seasoning", { name: "italian seasoning", quantity: 1, unit: "tbsp" });
  expectLine("2 cups cake topping", { name: "cake topping", quantity: 2, unit: "cup" });
  expectLine("100 g garnish", { name: "garnish", quantity: 100, unit: "g" });
});

test("a full markdown-pasted recipe needs no LLM rescue", () => {
  const pasted = `* 1 pound chicken drumsticks (4) skin removed
* ▢1 pound boneless skinless chicken thighs cut in half
* ▢2 to 3 teaspoons biryani masala
* ▢1 tablespoon [ginger paste](https://ministryofcurry.com/ginger-paste/)
* ▢½ teaspoon [ground turmeric](https://linksta.io/9067523e)
* ▢¾ cup plain yogurt

Rice Ingredients

* ▢2½ cups [Extra long grain Basmati rice](https://amzn.to/30CnH7V)
* ▢8 [cloves](https://amzn.to/2C1EhV5)

Garnish

* ▢2 tablespoons [ghee](https://ministryofcurry.com/homemade-ghee-instant-pot/) optional`;

  const items = parseIngredientText(pasted);
  const unparsed = items.filter((i) => i.status === "unparsed");

  // The whole point: unparsed lines are what get billed to the LLM.
  assert.equal(unparsed.length, 0, `unparsed: ${unparsed.map((i) => i.raw).join(" | ")}`);
  assert.equal(items.length, 9, "both section headings should be dropped");
  assert.ok(
    items.every((i) => i.ingredientName.trim() !== ""),
    "every kept line should have an ingredient name"
  );
});
