# FMC — Recipe Cost Calculator

Know exactly what a recipe costs to make. Enter ingredients in whatever units you cook with (g, cups, tbsp, dozen…), keep a **price book** of current market prices, and get live totals: ingredient cost, overhead, cost per serving, and a suggested selling price.

Built with Next.js (App Router), MongoDB Atlas, and HeroUI.

## Features

- **Recipes** — create, edit, delete; each has servings and an overhead % (gas/packaging/labor).
- **Unit-aware costing** — prices are entered per kg/L/piece; recipe quantities in any unit. Volume↔weight conversions use a built-in density table for ~35 common ingredients (a cup of flour ≠ a cup of honey). Lines that can't be costed show a warning with the reason instead of a wrong number.
- **Price book** — one place for current ingredient prices, with source and freshness (`3d ago`) per entry. Recipe autocomplete autofills from it.
- **Price sync** — scripts to pull daily Telangana mandi prices from data.gov.in and (best-effort) BigBasket prices for packaged goods, plus a GitHub Actions cron to run the gov sync daily.

## Setup

```bash
npm install
```

Create `.env` (never commit it):

```
MONGODB_URI=mongodb+srv://...
DATA_GOV_API_KEY=...   # optional, for the gov price sync
```

Then:

```bash
npm run dev            # http://localhost:3000
npm run seed           # seed the price book with ~40 Indian staples
```

## Price data scripts

| Script | What it does |
| --- | --- |
| `npm run seed` | Seeds/updates the price book with common staples; migrates legacy entries. |
| `npm run prices:gov` | Pulls daily mandi prices (data.gov.in, Agmarknet) for Telangana → price book. Needs `DATA_GOV_API_KEY` (free from [data.gov.in](https://data.gov.in)). Mandi = wholesale; retail runs ~20–40% higher. |
| `npm run prices:bigbasket` | Best-effort Playwright scrape of packaged-goods prices. Install first: `npm i -D playwright && npx playwright install chromium`. Personal-scale use only. |
| `node scripts/migrate_ingredients.mjs` | One-time: wraps the pre-rewrite flat `ingredients` collection into an "Imported recipe". |

The GitHub Actions workflow (`.github/workflows/update-prices.yml`) runs the gov sync daily at 09:00 IST; set `MONGODB_URI` and `DATA_GOV_API_KEY` as repo secrets.

## How costing works

Every price is "₹X per priceUnit" (kg, L, piece, dozen…). A recipe line converts its quantity into the price unit:

- same dimension → static factor table (1 cup = 240 mL, 1 dozen = 12 …)
- volume↔weight → via per-ingredient density (g/mL), matched by name substring
- count↔mass → impossible; the line flags an error telling you how to fix it

`total = Σ line costs × (1 + overhead%)`, `perServing = total / servings`, `suggested price = perServing × (1 + margin%)`.

Engine lives in [libs/units.js](libs/units.js); validation in [libs/validate.js](libs/validate.js).
