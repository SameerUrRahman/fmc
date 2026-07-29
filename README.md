# FMC — Recipe Cost Calculator

Know exactly what a recipe costs to make. Enter ingredients in whatever units you cook with (g, cups, tbsp, dozen…), keep a **price book** of current market prices, and get live totals: ingredient cost, overhead, cost per serving, and a suggested selling price.

Built with Next.js (App Router), MongoDB Atlas, and HeroUI.

**Live:** [fmc-livid.vercel.app](https://fmc-livid.vercel.app/) — real data, prices refreshed daily from data.gov.in.

> This is a personal/portfolio deployment with no authentication: the price book and recipes are world-writable by design, so treat the live instance as a demo rather than a system of record. Adding per-user accounts is tracked but deliberately deprioritized.

## Features

- **Recipes** — create, edit, delete; each has servings and an overhead % (gas/packaging/labor).
- **Unit-aware costing** — prices are entered per kg/L/piece; recipe quantities in any unit. Volume↔weight conversions use a built-in density table for ~35 common ingredients (a cup of flour ≠ a cup of honey). Lines that can't be costed show a warning with the reason instead of a wrong number.
- **Price book** — one place for current ingredient prices, with source and freshness (`3d ago`) per entry. Recipe autocomplete autofills from it.
- **Price sync** — scripts to pull daily Telangana mandi prices from data.gov.in and (best-effort) BigBasket prices for packaged goods, plus a GitHub Actions cron to run the gov sync daily.
- **Trends & scenarios** — a sparkline per price-book row, a chart of what each recipe would have cost on every day there are prices for, a ranked breakdown of which ingredients drive the cost, and a what-if slider bounded by each ingredient's *observed* price range ("every price at its peak, this recipe costs ₹X"). Plus reverse pricing: name a selling price, see the margin and ingredient budget it implies.
- **Log what you paid** — record a purchase as the receipt reads ("₹110 for 2 kg"), not as a unit price. It's the only source here that's ground truth rather than a market proxy, so it outranks every feed, and it doubles as feed validation: the form shows the gap against the price book as you type.
- **Import from a URL or pasted text** — paste a recipe link and the ingredient list is read off the page (most recipe sites publish `schema.org/Recipe`), or paste the list yourself from a blog, a YouTube description or WhatsApp. Either way the same parser handles it, and you review the draft before anything is added.
- **Price lookup for unknown ingredients** — an explicit "Look up" on any unpriced row tries the live data.gov.in feed, then a cached AI estimate. Anything nothing can price properly lands on a **wanted list** on the Price Book page.

What's planned next and why is in [ROADMAP.md](ROADMAP.md).

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill it in (never commit `.env`):

| Variable | Required? | What it's for |
| --- | --- | --- |
| `MONGODB_URI` | **yes** | Atlas connection string. |
| `DATA_GOV_API_KEY` | for price sync | Free key from [data.gov.in](https://data.gov.in). Without it `npm run prices:gov` exits immediately. |
| `GROQ_API_KEY` *or* `GEMINI_API_KEY` | optional | LLM rescue for ingredient lines the regex parser can't handle. Without a key the importer still works — unparsed lines just stay flagged for manual entry. |
| `LLM_PROVIDER` / `LLM_MODEL` | optional | Force a provider, or override the model for every task. |
| `LLM_MODEL_EXTRACT` / `LLM_MODEL_ESTIMATE` | optional | Override the model for one task only. Takes priority over `LLM_MODEL`. |
| `LLM_ESTIMATE_DAILY_CAP` | optional | How many *new* ingredients may get a fresh AI price estimate per IST day (default 25). Cached estimates don't count. The live instance has no auth, so this is what bounds quota burn. |
| `PRICE_FEED_STATE` | optional | Which state the live price lookup queries (default `Telangana`). |

Then:

```bash
npm run dev            # http://localhost:3000
npm run seed           # seed the price book with ~40 Indian staples
```

## Price data scripts

| Script | What it does |
| --- | --- |
| `npm test` | Runs `node:test` over `tests/*.test.mjs`. No test-framework dependency and no build step — Node ≥22.7 detects the module syntax in the ESM-in-`.js` libs. No database needed; the covered code is pure. |
| `npm run seed` | Seeds/updates the price book with common staples; migrates legacy entries. |
| `npm run prices:gov` | Pulls daily mandi prices (data.gov.in, Agmarknet) for Telangana → price book. Needs `DATA_GOV_API_KEY` (free from [data.gov.in](https://data.gov.in)). Mandi = wholesale; retail runs higher, and by more than the ~20–40% this file used to assert — spot-checking Hyderabad retail against the same day's feed gave onion +57% (₹35 → ₹55/kg) and tomato +135% (₹17 → ₹40/kg). Treat the mandi price as a floor, not a retail estimate; the purchase log is what makes the real gap measurable per commodity. Coverage varies day to day — markets don't report every commodity, so a typical run updates 8–12 of the ~23 mapped names, mostly fresh produce. |
| `npm run prices:bigbasket` | Best-effort Playwright scrape of packaged-goods prices. Install first: `npm i -D playwright && npx playwright install chromium`. Personal-scale use only. |
| `npm run prices:backfill` | One-time: seeds price history from the current price book, one snapshot per entry dated by its own `fetchedAt`. Safe to re-run. |
| `npm run prices:history` | Prints the observation log — summary, or `npm run prices:history -- onion` for one ingredient's series with day-over-day change. |
| `node scripts/migrate_ingredients.mjs` | One-time: wraps the pre-rewrite flat `ingredients` collection into an "Imported recipe". |

The GitHub Actions workflow (`.github/workflows/update-prices.yml`) runs the gov sync daily at 09:00 IST; set `MONGODB_URI` and `DATA_GOV_API_KEY` as repo secrets.

> **Note:** GitHub disables scheduled workflows after 60 days without repo activity, and Atlas M0 clusters pause after 60 days without a connection. The daily cron keeps the cluster warm — but if the repo goes quiet for two months, the cron stops and the cluster follows. Re-enable the workflow from the Actions tab if that happens.

## Deploying

Vercel Hobby + Atlas M0 + GitHub Actions on a public repo is free end to end.

1. Import the repo on Vercel.
2. Set `MONGODB_URI` (and `GROQ_API_KEY` if used) as Vercel environment variables for **Production and Preview**. Every route is server-rendered on demand, so a missing URI won't fail the build — it builds fine and then 500s at runtime, which is the more confusing failure. These are separate from the GitHub Actions secrets; both stores need their own copy.
3. In Atlas → Network Access, allow `0.0.0.0/0`. Vercel's serverless egress IPs are dynamic, so the connection-string password is the only thing guarding the database — use a long random one.

## How price history works

The price book (`KnownIngredients`) answers "what does onion cost *now*". It's a
materialized view: every sync overwrites it in place, so on its own it has no memory.

`PriceSnapshot` is the append-only log behind it — one document per
**(ingredient, source, IST day)**. Every price writer in the repo goes through an
`upsertPrice()`: [scripts/_shared.mjs](scripts/_shared.mjs) for the `.mjs` sync
scripts, [libs/prices.js](libs/prices.js) for the app's own API routes. Both
update the current value *and* append the observation, so history can't be
silently lost by a writer that forgets to record it. (The web routes originally
wrote `KnownIngredients` directly, which meant a price edited by hand in the UI
never reached the log — the same class of bug the snapshot log was built to fix.)

Two details that matter:

- **Days are Indian days.** The cron fires at 09:00 IST. Bucketing on a truncated
  UTC timestamp would split one Indian day across two buckets, so `observedOn` is
  an IST `YYYY-MM-DD` string and that string is the dedupe key.
- **Re-running a sync corrects, it doesn't duplicate.** A unique index on
  `(ingredientName, source, observedOn)` means the second run of a day upserts
  that day's reading. Sources are independent series, so a mandi price and a
  retail price for the same ingredient on the same day coexist — which is what
  makes the wholesale/retail spread measurable rather than guessed.

Everything before the first backfill is genuinely gone; the old sync overwrote
prices in place. History starts from the day snapshots landed.

### What the charts do with it

Reading is in [libs/priceHistory.js](libs/priceHistory.js) (server-only, touches
the model) and [libs/trends.js](libs/trends.js) (pure, no database, no React —
the part worth unit-testing).

- **Observations are restated in the row's current price unit** before charting.
  Otherwise switching an ingredient from ₹/kg to ₹/g draws a 1000× cliff that
  never happened.
- **Same day, several feeds → one point**, resolved by a source precedence
  (`purchase > doca-retail > bigbasket > data.gov.in > manual > llm-estimate`).
  Tiers are allowed to be absent; most don't exist yet.
- **Recipe cost over time** prices each ingredient at its most recent observation
  on or before each day. Feeds report on their own cadence, so requiring every
  ingredient to have a reading on the same day would leave almost no days at all.
  Each point carries a **coverage** figure — how much of that day's cost came
  from a real observation — so a flat line can be read as "only one ingredient is
  tracked" rather than "prices were stable".
- **Nothing is drawn below two distinct days.** The backfilled rows are one
  observation each; charted, they'd be a confident flat line asserting stability
  over data that says nothing. Those cells say `1 obs` instead. Expect that state
  until roughly mid-September 2026.

## How the LLM rescue behaves

The importer runs the regex parser first and only sends the lines it couldn't
handle to an LLM — one batched request per import, regardless of length. The
adapter is [libs/llmExtract.js](libs/llmExtract.js).

- **Models are picked per task, not globally.** Groq's free-tier rate limits are
  bucketed *per model* with independent counters, so a cheap task on a different
  model buys real headroom instead of competing with imports. Extraction has to
  emit a schema and gets the 70b; price estimates are a ballpark and get
  `llama-3.1-8b-instant`. Resolution order is
  explicit argument → `LLM_MODEL_<TASK>` → `LLM_MODEL` → per-task default.
- **Failures are classified, not stringified.** Calls throw an `LlmError`
  carrying `code` (`rate_limited` / `auth` / `server` / `network` /
  `bad_response` / `no_provider`), the HTTP status, and `retryAfterSec`. A 429
  reads `retry-after` first, then the longest `x-ratelimit-reset-*` window, then
  the wait Groq repeats in the response body — the headers don't say *which*
  bucket was exhausted, and waiting too long costs one slow import while waiting
  too little costs a second 429.
- **The UI acts on the difference.** A rate limit shows a live countdown and a
  retry button that unlocks when it hits zero; a bad key doesn't, because
  retrying it will never work.

The free-tier budget is 30 RPM / 1,000 RPD / 12k TPM / 100k TPD. Token cost
scales with how much the regex parser *missed*, so a high LLM-line count on an
ordinary recipe is a parser bug, not an expected cost.

## Importing a recipe from a URL

`POST /api/recipes/import-url` fetches a page and returns **raw ingredient text
lines**, which the client then sends to `/api/recipes/parse` — the same endpoint
pasted text goes through. A URL is an input channel, not a second parser, so
units, Hinglish aliases, LLM rescue and price-book matching behave identically
however the text arrived. All the extraction lives in
[libs/recipeUrl.js](libs/recipeUrl.js) and is pure, so it's tested against saved
HTML with no network.

The ladder, best evidence first — the badge in the importer says which rung fired:

| Rung | What it reads | Cost |
| --- | --- | --- |
| `json-ld` | `schema.org/Recipe` in `<script type="application/ld+json">` | one fetch |
| `microdata` | `itemprop="recipeIngredient"` | one fetch |
| `heuristic` | `<li>` under a heading matching *Ingredients* | one fetch |
| `llm` | the model picks which lines are ingredients | one fetch + one LLM call |

Measured on six real sites: four hit `json-ld` and spent **no** LLM call
(indianhealthyrecipes, bbcgoodfood, cookwithmanali, recipetineats); one returned
403 to a scripted client and one served its homepage instead of the recipe —
both surface as "paste the ingredient list instead" rather than a wrong import.
Anti-bot pages are the real failure mode here, not parsing.

**The LLM rung selects, it doesn't extract.** It's handed only the lines
carrying a quantity or a unit word, and its answer is *which of those lines are
ingredients* — those raw lines then go through the regex parser like any pasted
text. Sending a whole article instead would cost thousands of tokens per import
against a 100k/day budget, and output tokens dominate.

**This is an unauthenticated outbound fetch on a public instance**, which is the
part worth getting right. `normalizeRecipeUrl()` rejects non-HTTP schemes,
embedded credentials and private hosts; the hostname is re-resolved and every
resolved address re-checked against loopback / RFC1918 / CGNAT / link-local
(169.254.169.254 included) before the request goes out; redirects are followed
**manually** so each hop is re-validated, because `redirect: "follow"` would
happily land on a 302 into the metadata service unseen. Responses are capped at
1.5 MB, 10 s, and HTML content types. The endpoint returns extracted page *text*
only, never a raw response body.

## Pricing an ingredient no feed carries

Two tiers of last resort, both reachable only from an **explicit** user action —
never from an autocomplete or a keystroke handler, because at 30 requests/minute
two ingredient names of typing would trip the free-tier limit.

`POST /api/prices/lookup` tries, in order:

1. **The live data.gov.in feed** ([libs/priceLookup.js](libs/priceLookup.js)).
   Matching reuses the price-book matcher rather than a second commodity map, so
   it inherits the Hinglish alias table — "kanda" resolves to `Onion` and prices
   off 13 Telangana markets. The match threshold is stricter than the price
   book's (0.72 vs 0.6): a loose price-book match is visible next to the name it
   came from, but a loose *commodity* match silently writes cardamom prices onto
   coriander under an authoritative `data.gov.in` label.
2. **An AI estimate**, cached forever. The cache is keyed on the ingredient name
   alone, not the day — asking again tomorrow would cost a call and return the
   same guess. One call per ingredient, ever, plus a daily cap on *new*
   ingredients (`LLM_ESTIMATE_DAILY_CAP`, default 25) so a stranger on the open
   instance can't burn the quota.

> **An AI estimate never clears the wanted list.** The prompt tells the model to
> return `{"price":0}` for anything it can't price. It doesn't: asked for
> "qwertyx nonfood widget" it returned ₹299/piece ("assumed novelty item"), and
> for "zblorp gadget thing" ₹299/piece at *medium* confidence. Neither the
> refusal path nor the self-reported confidence separates a real ingredient from
> a string of noise — the model will price anything. So an estimate unblocks the
> recipe and is flagged `llm-estimate` at the bottom of the precedence chain, but
> the ingredient stays queued until a real source answers.

The **wanted list** (`WantedIngredient`) is that queue, shown on the Price Book
page and ordered by how often each name has been asked for. Only a feed hit or a
logged purchase resolves an entry, which is what makes the packaged-goods scrape
worth running against a list rather than the whole book.

## Logging what you paid

Every other price here is a market proxy. A receipt isn't, so `purchase` sits at
the top of the source precedence. Logic is in
[libs/purchases.js](libs/purchases.js) (pure, tested).

- **Entered as the receipt reads.** "₹110" and "2 kg" are two different lines on
  a bill; asking someone to divide before they can log a purchase is how a
  feature stops getting used. Unit price is derived and shown live.
- **Rounded to 4 decimals, not 2.** Per-gram prices are legitimate here — ₹60 for
  a 500 g pack is ₹0.12/g, and 2 decimals would quantize that into a real error
  in every recipe line priced in grams.
- **Today updates the price book; a backdated receipt doesn't.** A purchase from
  today is the best current answer to "what does this cost". One from three weeks
  ago belongs in history so the charts can see it — moving the current price
  backwards to match it would look exactly like the daily sync had broken.

## How costing works

Every price is "₹X per priceUnit" (kg, L, piece, dozen…). A recipe line converts its quantity into the price unit:

- same dimension → static factor table (1 cup = 240 mL, 1 dozen = 12 …)
- volume↔weight → via per-ingredient density (g/mL), matched by name substring
- count↔mass → impossible; the line flags an error telling you how to fix it

`total = Σ line costs × (1 + overhead%)`, `perServing = total / servings`, `suggested price = perServing × (1 + margin%)`.

Engine lives in [libs/units.js](libs/units.js); validation in [libs/validate.js](libs/validate.js).
