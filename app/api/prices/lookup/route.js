import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import PriceSnapshot from "@/models/PriceSnapshot";
import WantedIngredient from "@/models/WantedIngredient";
import { lookupGovPrice } from "@/libs/priceLookup";
import { llmAvailable, estimatePriceLLM } from "@/libs/llmExtract";
import { upsertPrice } from "@/libs/prices";
import { istDay } from "@/libs/istDay";
import { NextResponse } from "next/server";

// POST { ingredientName } -> { ok, price, priceUnit, source, detail, cached, llm }
//
// Item 6. Price an ingredient the price book doesn't know, in tiers:
//
//   1. data.gov.in mandi feed  — real, free, changes daily
//   2. a cached LLM estimate   — costs nothing, already paid for
//   3. a fresh LLM estimate    — costs one call, capped
//   4. the wanted list         — nothing worked; queue it for the manual scrape
//
// TRIGGERED BY AN EXPLICIT USER ACTION ONLY. Never wire this to an autocomplete
// or a keystroke handler: the free tier is 30 requests/minute, so two
// ingredient names of typing would trip it.

// Fresh LLM estimates per IST day, across all users. The live instance has no
// auth by design, so this is what stops a stranger burning the daily quota —
// the cache below makes each *ingredient* cost one call ever, and this caps how
// many new ingredients a single day can introduce.
const LLM_ESTIMATE_DAILY_CAP = Number(process.env.LLM_ESTIMATE_DAILY_CAP ?? 25);

/** Record (or re-record) a miss on the wanted list. */
async function noteWanted(ingredientName, lastError) {
  await WantedIngredient.findOneAndUpdate(
    { ingredientName },
    {
      $set: { lastAttemptAt: new Date(), status: "pending", lastError },
      $inc: { timesRequested: 1 },
      $setOnInsert: { ingredientName },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/** Close out a wanted-list entry once something finally priced it. */
async function resolveWanted(ingredientName, source) {
  await WantedIngredient.updateOne(
    { ingredientName },
    { $set: { status: "resolved", resolvedSource: source, lastAttemptAt: new Date(), lastError: "" } }
  );
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const ingredientName = String(body?.ingredientName ?? "").trim();
  if (!ingredientName) {
    return NextResponse.json({ error: "ingredient name is required" }, { status: 400 });
  }
  if (ingredientName.length > 120) {
    return NextResponse.json({ error: "that name is too long to look up" }, { status: 400 });
  }

  await connectMongoDB();

  // --- tier 1: the government feed ------------------------------------------
  const gov = await lookupGovPrice(ingredientName);
  if (gov.ok) {
    await upsertPrice({
      ingredientName,
      price: gov.price,
      priceUnit: gov.priceUnit,
      source: gov.source,
    });
    await resolveWanted(ingredientName, gov.source);
    return NextResponse.json({
      ok: true,
      price: gov.price,
      priceUnit: gov.priceUnit,
      source: gov.source,
      detail: gov.detail,
      cached: false,
    });
  }

  // --- tier 2: an estimate we already paid for ------------------------------
  // Keyed on the name alone, not the day: the whole point of caching an
  // estimate is that asking again tomorrow costs a call and returns the same
  // guess. One call per ingredient, ever.
  const cached = await PriceSnapshot.findOne({ ingredientName, source: "llm-estimate" })
    .sort({ observedAt: -1 })
    .lean();

  if (cached) {
    // Only touch the price book if it has nothing usable — re-applying a cached
    // guess over a price the user has since corrected would be a regression.
    const known = await KnownIngredients.findOne({ ingredientName }).lean();
    if (!known || !known.price) {
      await upsertPrice({
        ingredientName,
        price: cached.price,
        priceUnit: cached.priceUnit,
        source: "llm-estimate",
      });
    }
    return NextResponse.json({
      ok: true,
      price: cached.price,
      priceUnit: cached.priceUnit,
      source: "llm-estimate",
      detail: `estimated on ${cached.observedOn}, reused — no new AI call`,
      cached: true,
    });
  }

  // --- tier 3: a fresh estimate ---------------------------------------------
  if (!llmAvailable()) {
    await noteWanted(ingredientName, gov.reason);
    return NextResponse.json({
      ok: false,
      reason: gov.reason,
      detail: "no AI provider configured, so there's no fallback estimate",
      wanted: true,
    });
  }

  const usedToday = await PriceSnapshot.countDocuments({
    source: "llm-estimate",
    createdAt: { $gte: new Date(`${istDay()}T00:00:00+05:30`) },
  });
  if (usedToday >= LLM_ESTIMATE_DAILY_CAP) {
    await noteWanted(ingredientName, "daily AI estimate cap reached");
    return NextResponse.json({
      ok: false,
      reason: `today's AI estimate limit (${LLM_ESTIMATE_DAILY_CAP}) is used up`,
      detail: "added to the wanted list — it'll be priced by hand or by tomorrow's sync",
      wanted: true,
    });
  }

  let estimate;
  try {
    estimate = await estimatePriceLLM(ingredientName);
  } catch (e) {
    await noteWanted(ingredientName, String(e?.message ?? e));
    return NextResponse.json({
      ok: false,
      reason: String(e?.message ?? e),
      wanted: true,
      llm: { code: e?.code ?? "unknown", retryAfterSec: e?.retryAfterSec ?? null },
    });
  }

  if (!estimate) {
    await noteWanted(ingredientName, "the AI couldn't price it either");
    return NextResponse.json({
      ok: false,
      reason: `neither the feed nor the AI could price "${ingredientName}"`,
      detail: "added to the wanted list",
      wanted: true,
    });
  }

  await upsertPrice({
    ingredientName,
    price: estimate.price,
    priceUnit: estimate.priceUnit,
    source: "llm-estimate",
  });

  // An AI estimate prices the ingredient but does NOT clear it off the wanted
  // list. It is a guess that unblocks the recipe, not an observation.
  //
  // This is measured, not cautious-by-default. The prompt tells the model to
  // reply {"price":0} for anything it can't price; asked for "qwertyx nonfood
  // widget" it returned ₹299/piece ("assumed novelty item"), and asked for
  // "zblorp gadget thing" it returned ₹299/piece at *medium* confidence. So
  // neither the refusal path nor the self-reported confidence separates a real
  // ingredient from a string of noise — the model will price anything.
  //
  // Only a real source resolves a wanted entry: the feed above, or a logged
  // purchase (app/api/purchases/route.js). Until then the ingredient stays
  // queued for a genuine price, which is exactly what the list is for.
  await noteWanted(ingredientName, `priced only by AI estimate (${estimate.confidence} confidence)`);

  return NextResponse.json({
    ok: true,
    price: estimate.price,
    priceUnit: estimate.priceUnit,
    source: "llm-estimate",
    detail: estimate.basis
      ? `AI estimate (${estimate.confidence} confidence) — ${estimate.basis}`
      : `AI estimate (${estimate.confidence} confidence)`,
    cached: false,
  });
}
