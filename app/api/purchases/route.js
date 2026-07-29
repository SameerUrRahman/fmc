import connectMongoDB from "@/libs/mongodb";
import WantedIngredient from "@/models/WantedIngredient";
import { derivePurchase } from "@/libs/purchases";
import { recordPurchase } from "@/libs/prices";
import { NextResponse } from "next/server";

// POST { ingredientName, totalPaid, quantity, priceUnit, day?, note? }
//   -> { purchase, updatedBook }
//
// Item 7. Records what was actually paid as a `purchase` snapshot — the only
// source in the system that is ground truth rather than a market proxy.
// All the arithmetic and validation is in libs/purchases.js; this route is the
// database half.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const res = derivePurchase(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  await connectMongoDB();
  const { updatedBook } = await recordPurchase(res.value);

  // A receipt is the strongest source there is, so it closes out the wanted
  // list (item 6) — including entries an AI estimate priced but left queued.
  // The wanted-list chips in the Price Book tell the user that logging a
  // purchase is the fastest way off the list; this is what makes that true.
  await WantedIngredient.updateOne(
    { ingredientName: res.value.ingredientName },
    { $set: { status: "resolved", resolvedSource: "purchase", lastError: "" } }
  );

  const { ingredientName, price, priceUnit, observedOn, isCurrent } = res.value;
  return NextResponse.json(
    { purchase: { ingredientName, price, priceUnit, observedOn, isCurrent }, updatedBook },
    { status: 201 }
  );
}
