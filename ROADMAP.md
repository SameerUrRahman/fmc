# FMC — Roadmap

Ranked by combined portfolio value and daily usefulness, not by effort.

**The thesis:** FMC's real asset isn't the calculator, it's that it ingests a live
government price feed. Work that leans on that feed compounds; work that doesn't
is just another CRUD feature. The target pitch is *"a system that ingests a public
price feed daily, keeps it as an append-only time series, corrects it for the
wholesale→retail spread, and recomputes what my recipes cost over time"* — not
*"a recipe cost calculator."*

## Done

- [x] **Deploy** — live at https://fmc-livid.vercel.app (Vercel Hobby + Atlas M0 +
      Actions cron, free tier end to end). No auth, by design; documented in the
      README as a demo rather than a system of record.
- [x] **Append-only price history** (`PriceSnapshot`) — the daily sync used to
      overwrite prices in place and destroy the previous day's reading. Now every
      writer goes through `upsertPrice()`, which updates the current-price view
      *and* appends the observation. See "How price history works" in the README.
      Verified: `npm run prices:history` reports 45 snapshots seeded by the
      backfill, spanning 2026-07-21 → 2026-07-26. Real multi-observation series
      begin accumulating from the first cron run after 2026-07-26.
- [x] **Trends, breakdown, reverse pricing** (was item 4) — sparkline per
      price-book row, recipe cost-over-time with a coverage figure per day,
      ranked ingredient cost contribution, a what-if slider bounded by each
      ingredient's observed range, and reverse pricing in the cost card.
      Analysis split into [libs/trends.js](libs/trends.js) (pure, testable) and
      [libs/priceHistory.js](libs/priceHistory.js) (the model-touching read
      path). See "What the charts do with it" in the README.

      **Built ahead of its data on purpose, and it says so.** Nothing renders
      below two distinct observed days — those cells read `1 obs` and the recipe
      charts render an explanatory empty state — so the honest answer today is
      "not yet", not a flat line. The charts fill themselves in as the cron runs;
      re-check around mid-September 2026.

      Found and fixed while wiring it up: the app's own API routes wrote
      `KnownIngredients` directly and never appended a snapshot, so **every price
      edited by hand in the Price Book UI was invisible to history** — the exact
      failure the snapshot log exists to prevent, reintroduced on the web side
      because `upsertPrice()` only ever lived in the `.mjs` scripts. The routes
      now go through [libs/prices.js](libs/prices.js).

      Still not done, and blocked rather than skipped: the **mandi-vs-retail
      spread chart** needs two feeds for the same commodity on the same day, and
      item 1 (DoCA retail sync) hasn't shipped — there is only one series to
      plot. `dailySeries()` already resolves multi-source days by precedence, so
      the chart is additive once the second feed exists.

## Next

### 1. DoCA retail price sync — `S`
The Department of Consumer Affairs publishes daily **retail** prices for essential
commodities on data.gov.in, under the same free API key the mandi sync already
uses. Agmarknet gives wholesale, DoCA gives retail.

Why this over scraping BigBasket: it's the same pipeline shape, no bot protection,
no ToS question on a public repo, and it won't silently break. More importantly,
having both feeds for the same commodity on the same day makes the mandi→retail
spread a **measured, per-commodity, time-varying quantity** instead of the guessed
20–40% markup currently noted in the README. The snapshot schema was designed for
this — source is part of the dedupe key, so the two series coexist.

### 2. Costing correctness pass — `M`
One change across `libs/units.js`, the models, and `RecipeWorkspace`:

- **Resolve prices at read time.** `Recipe.ingredients` stores a frozen copy of
  `price`/`priceUnit`, so the daily sync currently never reaches recipe costs.
  Resolve via `knownIngredientId`, keep the stored value as a fallback for
  off-book ingredients and as an explicit user override, and show "priced as of X".
  (A denormalized price is correct for an *order* and a bug for a live *cost model* —
  knowing which you're building is the whole point.)
- **Source precedence:** `purchase > doca-retail > mandi × spread > manual > llm-estimate`.
  (`purchase` comes from item 7 below — until that ships the chain starts at
  `doca-retail`. Build the resolver so tiers can be absent rather than assuming
  all five exist.)
- **Yield/waste factor** per ingredient — a peeled onion isn't 100% usable.
- **Unit tests for `libs/units.js`** — it's pure, deterministic, and the trickiest
  code in the repo (density crossover, the count↔mass refusal, the `needsDensity`
  branch), and `convertPrice()` is now load-bearing for the trend charts.
  `libs/trends.js` wants the same treatment.

  The harness already exists: `npm test` runs `node:test` over `tests/*.test.mjs`
  — no test-framework dependency, and Node ≥22.7 detects the module syntax in the
  ESM-in-`.js` libs so they import with no build step. `tests/ingredientParser.test.mjs`
  is the worked example; it was mutation-checked (reverting the bullet fix fails
  4 of its 12 cases). Adding units/trends coverage is now writing cases, not
  standing up infrastructure.

### 3. Shopping list / batch planner — `M`
Select recipes at target servings, scale, normalize, aggregate, price the basket.
The only feature here that gets opened weekly. Needs a per-ingredient piece-weight
table (1 onion ≈ 110 g) beside the existing density table so "200 g onion" and
"2 piece onion" can merge — which also retires the visible count↔mass "can't cost"
failure.

### 4. Mandi-vs-retail spread chart — `S` *(needs item 1)*
The one piece of the trend work that couldn't be built: it needs two feeds for
the same commodity on the same day, and there is currently only one. Everything
else it depends on is in place — `dailySeries()` in
[libs/trends.js](libs/trends.js) already resolves multi-source days by
precedence, and the chart palette has a validated second series colour reserved.

This is the chart that turns the guessed 20–40% wholesale→retail markup into a
measured, per-commodity, time-varying number, so it's the real payoff of item 1
rather than a nice-to-have on top of it.

### 5. Harden `llmExtract` — `S`
Plumbing, not polish: item 6 can't be built safely without it.

- **Per-call model override.** `LLM_MODEL` is global today. Price estimates should
  run on `llama-3.1-8b-instant`, not the 70b — a ballpark price doesn't need it,
  it's faster, and Groq's rate-limit buckets are **per model** (verified: 12k TPM
  on `llama-3.3-70b-versatile` vs 8k TPM on `gpt-oss-20b`, independent counters),
  so splitting workloads buys real headroom instead of competing with imports.
- **Distinguish 429 from other failures.** A rate-limit error currently lands in
  the generic `catch` and surfaces as an opaque `llm.error`. Read `retry-after` /
  `x-ratelimit-reset-*` and return something the UI can render as "rate limited,
  try again in Ns".

Free-tier budget, for reference: **30 RPM / 1,000 RPD / 12k TPM / 100k TPD.** All
unparsed lines are batched into one request, so an import is one call regardless
of length — but the token cost scales with how much the regex parser *missed*,
and the earlier "≈550 tokens, ≈180 imports/day" figure was measured on a short,
clean list. A 27-line recipe pasted as markdown (checkbox glyphs, affiliate links
on half the lines) went to ~575 in / ~880 out ≈ **1,450 tokens**, or ≈65
imports/day — roughly 3x worse, and **output dominates**, which is easy to miss
when eyeballing prompt size. URLs are the main driver: they tokenize at ~2.2
chars/token against ~4 for prose.

The lever is the parser, not the model. After the bullet/markdown-link fixes the
same paste needs **zero** LLM lines. Budget for the LLM as a rescue path for
genuinely odd input, and treat a high LLM-line count on ordinary recipes as a
parser bug rather than an expected cost.

### 6. Unknown-ingredient handling — `S` *(needs item 5)*
On a price-book miss: try a live data.gov.in lookup (JSON API, fast, no bot
protection), fall back to an LLM price estimate via the existing
`libs/llmExtract.js` adapter (`source: "llm-estimate"`, flagged in the UI, bottom
of the precedence chain), and log the miss to a wanted list the manual scrape
works through first. **No headless browser in the request path** — Vercel's
egress is datacenter IPs, so a live scrape gets blocked, and the failure would be
synchronous and user-facing.

Two hard constraints: trigger on an **explicit** "look up price" action, never on
autocomplete keystrokes (at 30 RPM, two ingredient names of typing trips the
limit), and **cache every estimate as a snapshot** so an unknown ingredient costs
exactly one call ever — which is also what keeps the open public instance safe
from a stranger burning the daily quota.

### 7. Log what I paid — `S`
The only source that's ground truth for *my* costs rather than a market proxy.
Record the price when something is actually bought; writes to `PriceSnapshot` with
`source: "purchase"` and sits at the top of the precedence chain. No new
infrastructure — it's a form. Doubles as validation for the feeds ("retail said
₹48/kg, I paid ₹55"), which is a real finding about data quality rather than a
feature. Also the only practical answer for Tier-B goods the feeds never cover.

### 8. Volatility-aware staleness + provenance — `S`
`staleness()` in `components/PriceBook.jsx` applies one flat 7d/30d threshold to
everything, which is wrong in both directions: a 20-day-old honey price is fine, a
20-day-old tomato price is garbage. Derive each ingredient's threshold from its own
observed variance in `PriceSnapshot`, and surface a short "needs attention" list.
Show source + age per line in the recipe workspace, rolled up per recipe
("82% of this cost is backed by feed data from today").

### 9. Recipe import from URL — `S/M`
Most recipe sites emit `schema.org/Recipe` JSON-LD, so this is one fetch + a
JSON-LD parse feeding `recipeIngredient[]` into the existing parse pipeline, with
LLM-on-page-text as fallback. Best demo-per-hour on the list, but it adds an input
channel rather than a capability — do it when a fresh demo beat is wanted.

### 10. Packaged-goods scrape, reworked — `S` *(wanted list comes from item 6)*
Keep `scrape_bigbasket.mjs` **off** GitHub Actions. Rework as
`npm run prices:packaged`: run locally every 2–4 weeks from a residential IP, work
the wanted list first, print a diff. Packaged goods are MRP-anchored and move 2–4
times a year, so a low manual cadence isn't a compromise — it's the correct
frequency for that tier.

## Backlog — not scheduled

### Voice recipe entry via Whisper
`whisper-large-v3-turbo` is free on the existing `GROQ_API_KEY` — no new provider,
no new parsing work. Speak a recipe → transcript → straight into the
`parseIngredientText` + LLM-rescue + fuzzy-match pipeline that already exists,
because a transcript is just text entering the path built for pasted text.

Needs: a `MediaRecorder` capture control in `ImportIngredientsModal.jsx`, a route
forwarding the blob to Groq's `audio/transcriptions` endpoint, and the per-call
model override from item 5. Strong demo per hour spent; parked because it adds an
input channel rather than deepening the data pipeline, same reasoning as item 9.

## Explicitly not doing

- **PDF/Excel cost card.** "I generated a PDF" is a library call, not an engineering
  story, and there's nobody to hand a cost card to. If shareability is the goal, a
  public read-only recipe URL beats it on every axis.
- **Daily scraping of packaged goods.** Burning infrastructure to re-observe a
  number that changed last quarter.
- **Per-user auth.** Deliberately deferred; the live instance is a demo.

## Known small defects

- `npm run lint` is broken — `next lint` was removed in Next.js 16, so the script
  is parsed as `next <dir>`: *"Invalid project directory provided, no such
  directory: …\fmc\lint"*. Migrate to the ESLint CLI.
- `actions/checkout@v4` / `setup-node@v4` run on the deprecated Node 20 **action
  runtime**; bump to `@v5`. (Unrelated to `node-version: 22`, which is the app's
  runtime and is fine.)
- **The `PriceSnapshot` schema is duplicated** in `models/PriceSnapshot.js` and
  `scripts/_shared.mjs`, because the `.mjs` scripts can't import ESM-in-`.js`.
  Both copies carry a "change both together" comment, but nothing enforces it — a
  divergence here fails silently at write time. Fix by extracting the schema to a
  `.mjs` both sides can import.
- `.agent/` was committed in `5897894` — ~7,700 lines of agent skill docs now sit
  in a public portfolio repo an interviewer might browse. Consider `.gitignore`.
- "to taste" ingredients parse to quantity 0 and silently cost ₹0. Fine for salt,
  misleading for sugar. (Quantified-but-vague lines like "2 tbsp ghee optional"
  now keep their quantity; only genuinely unquantified ones fall to 0.)
- Section headings are dropped by an explicit keyword list, so an unlisted one
  ("Crispy Fried Onions") still imports as an ingredient. A heading and a bare
  ingredient are the same shape — "Garnish" vs "Star anise" — so anything looser
  starts eating real ingredients. Reviewing the draft catches it.
- No density entry for onion, so volume-quantified onion priced per kg can't cost.
  Reproduced live: importing "Onion - 1 katori chopped" yields 150 mL against a
  ₹31/kg price and fails with *"no density known for onion"*. Item 3's piece-weight
  table is the real fix.
