// Item 7: purchase logging.
//
// derivePurchase() is pure and does the arithmetic that decides what lands in
// the snapshot log, so it's worth pinning down. The cases that matter are the
// boundaries: the today/backdated split (which decides whether the price book
// moves), and the rounding (which decides whether per-gram prices survive).

import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePurchase, comparePurchase, MAX_BACKDATE_DAYS } from "../libs/purchases.js";
import { istDay, istNoon, isValidDay } from "../libs/istDay.js";

// A fixed clock so "today" doesn't drift under the suite. 2026-07-29 06:00 UTC
// is 11:30 IST the same day — comfortably mid-day in both zones.
const NOW = new Date("2026-07-29T06:00:00Z");
const TODAY = "2026-07-29";

const ok = (raw, now = NOW) => {
  const r = derivePurchase(raw, now);
  assert.ok(r.ok, `expected ok, got error: ${r.error}`);
  return r.value;
};
const fails = (raw, now = NOW) => {
  const r = derivePurchase(raw, now);
  assert.equal(r.ok, false, `expected failure for ${JSON.stringify(raw)}`);
  return r.error;
};

const base = { ingredientName: "onion", totalPaid: 110, quantity: 2, priceUnit: "kg" };

test("istDay bounds the IST day correctly", () => {
  assert.equal(istDay(NOW), TODAY);
  // 18:45 UTC is 00:15 IST the NEXT day — the case a UTC-truncating
  // implementation gets wrong, and the reason istDay exists at all.
  assert.equal(istDay(new Date("2026-07-29T18:45:00Z")), "2026-07-30");
  // 18:15 UTC is 23:45 IST, still the same day
  assert.equal(istDay(new Date("2026-07-29T18:15:00Z")), "2026-07-29");
});

test("isValidDay rejects dates that parse but don't exist", () => {
  assert.equal(isValidDay("2026-07-29"), true);
  assert.equal(isValidDay("2026-02-29"), false); // 2026 is not a leap year
  assert.equal(isValidDay("2026-02-31"), false); // rolls forward to March
  assert.equal(isValidDay("2026-13-01"), false);
  assert.equal(isValidDay("29-07-2026"), false);
  assert.equal(isValidDay(""), false);
});

test("istNoon anchors mid-day IST, not midnight", () => {
  const at = istNoon("2026-07-29");
  assert.equal(istDay(at), "2026-07-29");
  assert.equal(at.toISOString(), "2026-07-29T06:30:00.000Z");
});

test("derives unit price from what the receipt says", () => {
  const v = ok(base);
  assert.equal(v.price, 55);
  assert.equal(v.priceUnit, "kg");
  assert.equal(v.observedOn, TODAY);
});

test("per-gram prices keep enough precision to survive", () => {
  // ₹60 for a 500 g pack is ₹0.12/g exactly; the failure mode this guards is
  // rounding to 2 decimals, which is fine for ₹/kg and lossy for ₹/g.
  assert.equal(ok({ ...base, ingredientName: "saffron", totalPaid: 60, quantity: 500, priceUnit: "g" }).price, 0.12);
  // ₹250 for 3 kg = ₹83.3333…/kg — 4dp keeps it inside 0.001% of true
  assert.equal(ok({ ...base, totalPaid: 250, quantity: 3 }).price, 83.3333);
});

test("a purchase today moves the price book; a backdated one does not", () => {
  assert.equal(ok({ ...base }).isCurrent, true);
  assert.equal(ok({ ...base, day: TODAY }).isCurrent, true);

  const old = ok({ ...base, day: "2026-07-01" });
  assert.equal(old.isCurrent, false);
  assert.equal(old.observedOn, "2026-07-01");
  // and it's stamped inside the day it claims, not on the boundary
  assert.equal(istDay(old.observedAt), "2026-07-01");
});

test("rejects the impossible and the mistyped", () => {
  assert.match(fails({ ...base, ingredientName: "  " }), /which ingredient/i);
  assert.match(fails({ ...base, totalPaid: 0 }), /more than ₹0/);
  assert.match(fails({ ...base, totalPaid: -5 }), /more than ₹0/);
  assert.match(fails({ ...base, totalPaid: "abc" }), /more than ₹0/);
  assert.match(fails({ ...base, quantity: 0 }), /more than 0/);
  assert.match(fails({ ...base, priceUnit: "quintal" }), /unit must be one of/);
  assert.match(fails({ ...base, day: "2026-02-31" }), /not a real date/);
});

test("refuses the future and the distant past", () => {
  assert.match(fails({ ...base, day: "2026-07-30" }), /in the future/);
  // exactly at the limit is allowed, one day past it is not
  const atLimit = istDay(new Date(istNoon(TODAY).getTime() - MAX_BACKDATE_DAYS * 86400000));
  assert.equal(derivePurchase({ ...base, day: atLimit }, NOW).ok, true);
  const tooOld = istDay(new Date(istNoon(TODAY).getTime() - (MAX_BACKDATE_DAYS + 1) * 86400000));
  assert.match(fails({ ...base, day: tooOld }), /check the date/);
});

test("notes are trimmed and bounded", () => {
  assert.equal(ok({ ...base, note: "  Ratnadeep  " }).note, "Ratnadeep");
  assert.equal(ok({ ...base, note: "x".repeat(500) }).note.length, 200);
  assert.equal(ok({ ...base }).note, "");
});

test("comparePurchase reports the gap against the price book", () => {
  // the headline case from the roadmap: "retail said ₹48/kg, I paid ₹55"
  const c = comparePurchase(55, 48);
  assert.equal(c.direction, "higher");
  assert.ok(Math.abs(c.deltaPct - 14.583) < 0.01);

  assert.equal(comparePurchase(40, 48).direction, "lower");
  assert.equal(comparePurchase(48, 48).direction, "same");
  // sub-half-a-percent is noise, not a finding
  assert.equal(comparePurchase(48.1, 48).direction, "same");

  // nothing to compare against
  assert.equal(comparePurchase(55, 0), null);
  assert.equal(comparePurchase(55, null), null);
  assert.equal(comparePurchase(NaN, 48), null);
});
