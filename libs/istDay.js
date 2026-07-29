// The IST calendar day, alone in its own module.
//
// This function is the dedupe key for every price observation in the repo, so
// it gets imported by pure code (libs/purchases.js, the tests) and by
// model-touching code (libs/priceHistory.js, libs/prices.js) alike. It used to
// live in priceHistory.js, which imports the PriceSnapshot model — importing it
// from a test or a client component pulled mongoose along with it.
//
// scripts/_shared.mjs keeps its own copy because the .mjs scripts can't import
// ESM-in-.js. That copy and this one must agree; they are both three lines of
// Intl with the same options, which is the cheapest form that duplication takes.

/**
 * The IST calendar day for an instant, as "YYYY-MM-DD".
 *
 * Snapshots bucket by Indian day, not UTC day: the cron fires at 09:00 IST, and
 * a UTC-midnight boundary would split a single Indian day across two buckets
 * (and file the 09:00 IST run of the 1st under the UTC day of the 31st).
 */
export function istDay(date = new Date()) {
  // en-CA formats as YYYY-MM-DD, which is exactly what we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * The instant to stamp on an observation recorded *for* a given IST day.
 *
 * Midday IST, deliberately: a backdated purchase has no real clock time, and
 * anchoring at midnight would sit close enough to the day boundary that any
 * timezone slip in a caller would file it under the wrong day. Noon has 12
 * hours of slack on either side.
 */
export function istNoon(day) {
  return new Date(`${day}T12:00:00+05:30`);
}

/** Is this a well-formed "YYYY-MM-DD" that names a real calendar date? */
export function isValidDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ""))) return false;
  const at = istNoon(day);
  if (Number.isNaN(at.getTime())) return false;
  // round-trips only if the date exists — "2026-02-31" parses but comes back
  // as March 3rd, and a purchase filed under a day that isn't a day is a bug
  // we would only notice months later in a chart.
  return istDay(at) === day;
}
