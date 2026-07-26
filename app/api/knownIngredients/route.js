import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import { validateKnownIngredient } from "@/libs/validate";
import { upsertPrice } from "@/libs/prices";
import { NextResponse } from "next/server";

export async function GET() {
  await connectMongoDB();
  const ingredients = await KnownIngredients.find().sort({ ingredientName: 1 });
  return NextResponse.json({ ingredients });
}

// Upsert by ingredientName so re-adding an ingredient updates its price.
// Goes through upsertPrice() so the write also lands in the history log.
export async function POST(request) {
  const body = await request.json();
  const res = validateKnownIngredient(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  await connectMongoDB();
  const ingredient = await upsertPrice(res.value);
  return NextResponse.json({ ingredient }, { status: 201 });
}
