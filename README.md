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
| `LLM_PROVIDER` / `LLM_MODEL` | optional | Force a provider or override the default model. |

Then:

```bash
npm run dev            # http://localhost:3000
npm run seed           # seed the price book with ~40 Indian staples
```

## Price data scripts

| Script | What it does |
| --- | --- |
| `npm run seed` | Seeds/updates the price book with common staples; migrates legacy entries. |
| `npm run prices:gov` | Pulls daily mandi prices (data.gov.in, Agmarknet) for Telangana → price book. Needs `DATA_GOV_API_KEY` (free from [data.gov.in](https://data.gov.in)). Mandi = wholesale; retail runs ~20–40% higher. Coverage varies day to day — markets don't report every commodity, so a typical run updates 8–12 of the ~23 mapped names, mostly fresh produce. |
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

## How costing works

Every price is "₹X per priceUnit" (kg, L, piece, dozen…). A recipe line converts its quantity into the price unit:

- same dimension → static factor table (1 cup = 240 mL, 1 dozen = 12 …)
- volume↔weight → via per-ingredient density (g/mL), matched by name substring
- count↔mass → impossible; the line flags an error telling you how to fix it

`total = Σ line costs × (1 + overhead%)`, `perServing = total / servings`, `suggested price = perServing × (1 + margin%)`.

Engine lives in [libs/units.js](libs/units.js); validation in [libs/validate.js](libs/validate.js).
