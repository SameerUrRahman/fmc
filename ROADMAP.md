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

### 1. DoCA retail price sync — **blocked: the premise is false**
Investigated 2026-07-29. **There is no live DoCA retail feed on data.gov.in.**
Checked against the API with the real key:

- Org "Department of Consumer Affairs" has exactly 20 datasets, all frozen — the
  titles literally end *"upto April - 2015"*.
- A full-catalog title sweep found only two resources updated in 2026, and both
  are Agmarknet **wholesale**.
- `fcainfoweb.nic.in/PMSAPI/api/GetDailyPrices` exists but returns
  `401 "Token Missing"` — it's the internal app API, not a public one.
- The DoCA web report portal (`report_menu_web.aspx`) carries a
  `ctl00$MainContent$Captcha` field. Not going there: a public repo whose cron
  solves a government CAPTCHA is not a portfolio asset.

**The substitute that does work.** Resource `35985678` — *"Variety-wise Daily
Market Prices Data of Commodity"* — is the Agmarknet **historical archive**:
80.8M rows, back to 2004, current to within a day or two, same free key. Its
`Market` column mixes APMC wholesale yards with **Rythu Bazars**, Telangana's
government retail farmer markets, so both tiers appear for the same commodity on
the same day from one API. Measured over 20–22 July 2026:

| Day | Commodity | Rythu Bazar | APMC | Spread |
| --- | --- | --- | --- | --- |
| 20/07 | Onion | ₹26.80 | ₹20.62 | +30% |
| 21/07 | Onion | ₹27.00 | ₹21.78 | +24% |
| 20/07 | Tomato | ₹21.25 | ₹13.82 | +54% |
| 22/07 | Tomato | ₹20.50 | ₹12.82 | +60% |

Caveat, not to be oversold: a Rythu Bazar is farmer-direct, so it's a *floor* on
retail, not a supermarket price. Item 7's purchase log measured the real
supermarket gap at +57% (onion) and +135% (tomato) — so there are arguably three
tiers here, not two.

The same archive would also **backfill real multi-day history today** instead of
waiting for the cron to accumulate, which is independently the cheapest way to
make the already-built trend charts render something.

Open decision — none of these is started:
**(a)** ship the Rythu Bazar tier as `source: "rythu-bazar"`;
**(b)** backfill history from the archive;
**(c)** both, backfill first;
**(d)** drop the second feed, keep the purchase log as the retail basis, go to item 2.

### 2. Costing correctness pass — `M`
One change across `libs/units.js`, the models, and `RecipeWorkspace`:

- **Resolve prices at read time.** `Recipe.ingredients` stores a frozen copy of
  `price`/`priceUnit`, so the daily sync currently never reaches recipe costs.
  Resolve via `knownIngredientId`, keep the stored value as a fallback for
  off-book ingredients and as an explicit user override, and show "priced as of X".
  (A denormalized price is correct for an *order* and a bug for a live *cost model* —
  knowing which you're building is the whole point.)
- **Source precedence:** `purchase > doca-retail > mandi × spread > manual > llm-estimate`.
  (`purchase` and `llm-estimate` both exist now — items 7 and 6 shipped. `doca-retail`
  never will; see item 1. Build the resolver so tiers can be absent rather than
  assuming all five exist — `sourceRank()` in `libs/trends.js` already works this way.)
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

### 4. Mandi-vs-retail spread chart — `S` *(still needs a second feed — see item 1)*
The one piece of the trend work that couldn't be built: it needs two feeds for
the same commodity on the same day, and there is currently only one. Everything
else it depends on is in place — `dailySeries()` in
[libs/trends.js](libs/trends.js) already resolves multi-source days by
precedence, and the chart palette has a validated second series colour reserved.

This is the chart that turns the guessed 20–40% wholesale→retail markup into a
measured, per-commodity, time-varying number, so it's the real payoff of item 1
rather than a nice-to-have on top of it.

### ~~5. Harden `llmExtract`~~ — done
Plumbing for item 6, shipped ahead of it.

- **Per-task model selection.** `modelFor(task, provider, override)` resolves
  explicit argument → `LLM_MODEL_<TASK>` → `LLM_MODEL` → per-task default, so
  `extract` stays on the 70b while `estimate` gets `llama-3.1-8b-instant`.
  Groq's rate-limit buckets are **per model** with independent counters, so this
  is headroom, not cosmetics.
- **Classified failures.** Calls now throw `LlmError` with `code`
  (`rate_limited` / `auth` / `server` / `network` / `bad_response` /
  `no_provider`), `status`, and `retryAfterSec`, surfaced through
  `/api/recipes/parse` as `llm.code` / `llm.retryAfterSec`. The importer renders
  a rate limit as a live countdown with a retry button that unlocks at zero, and
  a bad key as a plain failure with no retry affordance — retrying that never
  helps.
- **Covered by tests** (`tests/llmExtract.test.mjs`, 17 cases): the model
  precedence chain, `retry-after` / `x-ratelimit-reset-*` / Go-duration /
  HTTP-date parsing, and 429 / 401 / 503 classification driven through the real
  code path with a stubbed `fetch`. Writing them caught a live bug — the
  body-prose fallback regex swallowed the trailing full stop in
  *"try again in 7.66s."* and parsed to `null`, which would have shown "try
  again shortly" instead of a countdown on exactly the responses that omit the
  headers.

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

### ~~6. Unknown-ingredient handling~~ — done
`POST /api/prices/lookup`, reachable from a **Look up** button that appears only
on unpriced price-book rows. Explicit action only — never wired to autocomplete.

- **Tier 1, the live feed** ([libs/priceLookup.js](libs/priceLookup.js)). Matching
  reuses `matchKnownIngredient()` against synthetic one-field docs rather than a
  second commodity map, so it inherits the Hinglish alias table for free —
  verified live: "kanda" → `Onion` across 13 Telangana markets, ₹25.91/kg.
  Threshold raised to **0.72** (vs the price book's 0.6) because the two mistakes
  aren't symmetric: a loose price-book match is visible next to the name it came
  from, a loose commodity match writes cardamom prices onto coriander under a
  `data.gov.in` label and is never questioned again.
- **Tier 2/3, AI estimate, cached forever.** Keyed on name alone, not day — the
  point of caching a guess is that asking tomorrow costs a call and returns the
  same guess. Plus `LLM_ESTIMATE_DAILY_CAP` (25) on *new* ingredients per day,
  which is what bounds quota burn on the no-auth public instance.
- **Wanted list** (`WantedIngredient`), surfaced on the Price Book page, ordered
  by how often each name has been asked for. Only a feed hit or a logged purchase
  resolves an entry.

**The finding that changed the design:** the estimate prompt tells the model to
reply `{"price":0}` for anything it can't price, and it doesn't. Asked for
"qwertyx nonfood widget" it returned ₹299/piece ("assumed novelty item"); asked
for "zblorp gadget thing", ₹299/piece at **medium** confidence. So neither the
refusal path nor the self-reported confidence separates a real ingredient from a
string of noise — *the model will price anything*. The first cut gated on
`confidence === "low"` and would have been worthless. An AI estimate now unblocks
the recipe but never clears the wanted list; only a real source does.

### ~~7. Log what I paid~~ — done
`POST /api/purchases` + a modal on the Price Book. Logic in
[libs/purchases.js](libs/purchases.js) (pure, 9 test cases).

- **Entered as the receipt reads** — "₹110" and "2 kg", not a unit price.
  Requiring the user to divide first is how a form stops getting used.
- **4-decimal rounding, not 2.** ₹60 for a 500 g pack is ₹0.12/g; 2 decimals
  quantizes that into a real error in every gram-priced recipe line.
- **Today updates the price book; backdated goes to history only.** Verified
  both ways: a same-day onion purchase moved the row to `source: purchase`, while
  a receipt dated four days back left the current price on `data.gov.in ₹17` and
  still showed up in the sparkline.
- **Resolves wanted-list entries**, which is what makes the "log what you paid to
  clear this" prompt in the UI true rather than decorative.

**It immediately falsified the README.** Hyderabad retail vs the same day's mandi
feed: onion ₹35 → ₹55/kg (**+57%**), tomato ₹17 → ₹40/kg (**+135%**). The
long-asserted "retail runs ~20–40% higher" was wrong in general and badly wrong
for tomato. That is the feed-validation payoff working on day one.

### 8. Volatility-aware staleness + provenance — `S`
`staleness()` in `components/PriceBook.jsx` applies one flat 7d/30d threshold to
everything, which is wrong in both directions: a 20-day-old honey price is fine, a
20-day-old tomato price is garbage. Derive each ingredient's threshold from its own
observed variance in `PriceSnapshot`, and surface a short "needs attention" list.
Show source + age per line in the recipe workspace, rolled up per recipe
("82% of this cost is backed by feed data from today").

### ~~9. Recipe import from URL~~ — done
`POST /api/recipes/import-url` + a **From URL** tab on the import modal.
Extraction is pure and lives in [libs/recipeUrl.js](libs/recipeUrl.js)
(18 test cases, no network); the route owns fetching only.

- **It returns text lines, not costed ingredients.** They go to
  `/api/recipes/parse`, the same endpoint pasted text uses, so a URL is an input
  channel and not a second parser. The fetched lines land in the textarea first,
  so a bad extraction is visible and editable rather than silently becoming a draft.
- **A ladder, and the UI says which rung fired:** `json-ld` → `microdata` →
  `heuristic` (`<li>` under an *Ingredients* heading) → `llm`. Measured on six
  real sites, **four hit JSON-LD and spent no LLM call at all**; one 403'd a
  scripted client and one served its homepage instead of the recipe. Anti-bot
  pages, not parsing, are the failure mode — both cases end in "paste the
  ingredient list instead" rather than a wrong import.
- **The LLM rung selects rather than extracts.** It sees only the lines carrying
  a quantity or unit word and answers *which of these are ingredients*; those raw
  lines then go through the regex parser as usual. Feeding it whole article text
  would cost thousands of tokens against a 100k/day budget, and item 5 established
  that output dominates.
- **Title and yield are adopted only if untouched** — a recipe still named
  "New Recipe" at 1 serving takes the page's name and `recipeYield`. An import
  adds ingredients; it doesn't get to rename a recipe you named.

**The part that needed the actual care was the fetch, not the parse.** This adds
an unauthenticated outbound fetch primitive to a public no-auth instance, so:
scheme/credential/private-host checks up front, the hostname re-resolved and
*every* resolved address re-checked (loopback, RFC1918, CGNAT, 169.254.169.254),
redirects followed **manually** so each hop is re-validated — `redirect: "follow"`
would land on a 302 into the metadata service with no way to see it happened —
and 1.5 MB / 10 s / HTML-only caps. The endpoint returns extracted page text,
never a raw body. Those rules are exported pure and tested, so they're checked
rather than asserted. Remaining gap, stated rather than hidden: DNS rebinding
between the lookup and `fetch()`'s own resolution is still possible; closing it
needs a pinned-IP agent, which is more machinery than a demo importer warrants.

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
input channel rather than deepening the data pipeline — the same reason item 9
sat unbuilt until a fresh demo beat was wanted.

## Explicitly not doing

- **PDF/Excel cost card.** "I generated a PDF" is a library call, not an engineering
  story, and there's nobody to hand a cost card to. If shareability is the goal, a
  public read-only recipe URL beats it on every axis.
- **Daily scraping of packaged goods.** Burning infrastructure to re-observe a
  number that changed last quarter.
- **Per-user auth.** Deliberately deferred; the live instance is a demo.

## Known small defects

- ~~**`dns.setServers()` in `libs/mongodb.js` doesn't reach the driver's SRV
  lookup.**~~ Fixed 2026-07-28. The hunch was right — the override was landing on
  a resolver the driver wasn't using — and it was the *promise* API. Node binds
  the callback and promise DNS APIs to the default resolver when each is first
  loaded; `dns.setServers()` only reliably rebinds the callback side, and whether
  `dns.promises` follows depends on load order. Under Next/Turbopack it loses that
  race, so inside one process `dns.getServers()` reported `8.8.8.8` while
  `dns.promises.getServers()` still reported the system stub. The driver resolves
  SRV with `dns.promises.resolve(host, "SRV")`, so it read the stale one and every
  page 500d. Adding `dnsPromises.setServers()` alongside removes the load-order
  dependency; done in both `libs/mongodb.js` and `scripts/_shared.mjs`.

  The tell that it was load-order and not the driver: API routes connected fine
  while page renders 500d in the *same* pid, and a second module eval after HMR
  came up correct.

  Worth noting this is a workaround for one machine's resolver (a 127.0.0.1 stub
  that refuses SRV), not a bug others hit — Atlas + Next needs none of this on a
  normal network. It ships to Vercel, where it needlessly forces public DNS.
  Gating it behind an env var, or fixing the local resolver and deleting it, is
  the cleaner end state.

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

  Item 7 hit this immediately: adding the `note` field meant editing both copies
  by hand, and forgetting the second one would have silently dropped purchase
  notes written by the scripts. `istDay()` had the same shape and *was* fixed —
  it now lives alone in [libs/istDay.js](libs/istDay.js) so pure code, tests, and
  the model-touching read path all share one definition (only the `.mjs` copy
  remains). The schema deserves the same treatment.
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
