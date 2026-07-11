import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import { parseIngredientText } from "@/libs/ingredientParser";
import { matchKnownIngredient, MATCH_THRESHOLD } from "@/libs/ingredientMatch";
import { llmAvailable, extractIngredientsLLM } from "@/libs/llmExtract";
import { NextResponse } from "next/server";

// POST { text } -> { items, llm: { available, used, error } }
// Parses pasted recipe text into draft ingredient lines: regex first,
// free-tier LLM rescue for lines regex couldn't handle, then fuzzy match
// against the price book to autofill prices. Nothing is saved here —
// the client shows the draft for user review.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const text = String(body?.text ?? "");
  if (!text.trim()) {
    return NextResponse.json({ error: "paste some recipe text first" }, { status: 400 });
  }
  if (text.length > 20000) {
    return NextResponse.json({ error: "text too long (20k characters max)" }, { status: 400 });
  }

  const items = parseIngredientText(text);
  const llm = { available: llmAvailable(), used: false, error: null };

  // LLM rescue for unparsed lines only — keeps free-tier usage tiny
  const unparsedIdx = items
    .map((item, i) => (item.status === "unparsed" ? i : -1))
    .filter((i) => i !== -1);
  if (unparsedIdx.length > 0 && llm.available) {
    try {
      const rescued = await extractIngredientsLLM(unparsedIdx.map((i) => items[i].raw));
      for (const [k, fixed] of rescued) {
        const i = unparsedIdx[k];
        items[i] = { ...items[i], ...fixed, status: "llm" };
      }
      llm.used = true;
    } catch (e) {
      llm.error = String(e.message || e);
    }
  }

  // fuzzy match against the price book
  await connectMongoDB();
  const knowns = await KnownIngredients.find().lean();
  const draft = items.map((item) => {
    if (!item.ingredientName) {
      return { ...item, match: null };
    }
    const { known, score } = matchKnownIngredient(item.ingredientName, knowns);
    if (known && score >= MATCH_THRESHOLD) {
      return {
        ...item,
        match: {
          knownIngredientId: String(known._id),
          matchedName: known.ingredientName,
          price: known.price,
          priceUnit: known.priceUnit,
          score: Math.round(score * 100) / 100,
        },
      };
    }
    return { ...item, match: null };
  });

  return NextResponse.json({ items: draft, llm });
}
