// Item 6: the data.gov.in lookup tier.
//
// The pure half — quintal arithmetic and commodity matching — is what decides
// whether a wrong price gets written under an authoritative source label, so it
// gets the coverage. The fetch half is exercised through lookupGovPrice() with
// a stubbed global fetch, the same approach tests/llmExtract.test.mjs uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  perKgByCommodity,
  matchCommodity,
  lookupGovPrice,
  COMMODITY_MATCH_THRESHOLD,
} from "../libs/priceLookup.js";

const rec = (commodity, modal_price, market = "Bowenpally") => ({
  commodity,
  modal_price: String(modal_price),
  market,
  state: "Telangana",
});

test("modal_price is ₹/quintal and averages across markets", () => {
  const by = perKgByCommodity([
    rec("Onion", 2000, "Bowenpally"),
    rec("Onion", 2400, "Gudimalkapur"),
    rec("Tomato", 1300),
  ]);
  assert.equal(by.get("Onion").perKg, 22); // (20 + 24) / 2
  assert.equal(by.get("Onion").markets, 2);
  assert.equal(by.get("Tomato").perKg, 13);
});

test("junk rows are dropped, not averaged in", () => {
  const by = perKgByCommodity([
    rec("Onion", 2000),
    rec("Onion", 0), // a zero would drag the average down 50%
    rec("Onion", "NR"), // markets report "NR" for no-report days
    rec("", 1500),
    rec("Potato", -100),
  ]);
  assert.equal(by.get("Onion").perKg, 20);
  assert.equal(by.get("Onion").markets, 1);
  assert.equal(by.has("Potato"), false);
  assert.equal(by.has(""), false);
});

test("perKgByCommodity survives empty and missing input", () => {
  assert.equal(perKgByCommodity([]).size, 0);
  assert.equal(perKgByCommodity(undefined).size, 0);
  assert.equal(perKgByCommodity(null).size, 0);
});

test("matches through prep words and Hinglish, reusing the price-book matcher", () => {
  const by = perKgByCommodity([rec("Onion", 2000), rec("Tomato", 1300), rec("Garlic", 8000)]);

  assert.equal(matchCommodity("onion", by).commodity, "Onion");
  assert.equal(matchCommodity("Onion, finely chopped", by).commodity, "Onion");
  // NAME_ALIASES translation — the importer's alias table pays off here too
  assert.equal(matchCommodity("pyaz", by).commodity, "Onion");
  assert.equal(matchCommodity("tamatar", by).commodity, "Tomato");
  assert.equal(matchCommodity("lehsun", by).commodity, "Garlic");

  assert.equal(matchCommodity("onion", by).perKg, 20);
});

test("refuses a weak match rather than writing a confident wrong price", () => {
  const by = perKgByCommodity([rec("Cardamom", 200000), rec("Onion", 2000)]);
  // the failure this threshold exists to prevent: a loose match would price
  // coriander at cardamom rates under a `data.gov.in` label and never be
  // questioned again
  assert.equal(matchCommodity("coriander powder", by), null);
  assert.equal(matchCommodity("vanilla essence", by), null);
  assert.equal(matchCommodity("", by), null);
  assert.ok(COMMODITY_MATCH_THRESHOLD > 0.6, "must be stricter than MATCH_THRESHOLD");
});

/** Run a body with global fetch stubbed to return `records`. */
async function withRecords(records, body, { status = 200 } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ records }),
    text: async () => JSON.stringify({ records }),
  });
  try {
    return await body();
  } finally {
    globalThis.fetch = real;
  }
}

test("lookupGovPrice returns a priced hit", async () => {
  const out = await withRecords([rec("Onion", 2000), rec("Onion", 2400)], () =>
    lookupGovPrice("pyaz", { apiKey: "test-key" })
  );
  assert.equal(out.ok, true);
  assert.equal(out.price, 22);
  assert.equal(out.priceUnit, "kg");
  assert.equal(out.source, "data.gov.in");
  assert.match(out.detail, /matched "Onion" across 2 Telangana markets/);
});

test("lookupGovPrice reports misses instead of throwing", async () => {
  const noKey = await lookupGovPrice("onion", { apiKey: "" });
  assert.equal(noKey.ok, false);
  assert.match(noKey.reason, /DATA_GOV_API_KEY/);

  const empty = await withRecords([], () => lookupGovPrice("onion", { apiKey: "k" }));
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /no Telangana prices today/);

  const unmatched = await withRecords([rec("Cardamom", 200000)], () =>
    lookupGovPrice("vanilla essence", { apiKey: "k" })
  );
  assert.equal(unmatched.ok, false);
  assert.match(unmatched.reason, /no matching commodity/);

  const broken = await withRecords([], () => lookupGovPrice("onion", { apiKey: "k" }), {
    status: 503,
  });
  assert.equal(broken.ok, false);
  assert.match(broken.reason, /couldn't reach data\.gov\.in/);
});

test("a network failure is a miss, not an exception", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  try {
    const out = await lookupGovPrice("onion", { apiKey: "k" });
    assert.equal(out.ok, false);
    assert.match(out.reason, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = real;
  }
});
