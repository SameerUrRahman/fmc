import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import { validateKnownIngredient } from "@/libs/validate";
import { NextResponse } from "next/server";

export async function GET() {
  await connectMongoDB();
  const ingredients = await KnownIngredients.find().sort({ ingredientName: 1 });
  return NextResponse.json({ ingredients });
}

// Upsert by ingredientName so re-adding an ingredient updates its price.
export async function POST(request) {
  const body = await request.json();
  const res = validateKnownIngredient(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  await connectMongoDB();
  const ingredient = await KnownIngredients.findOneAndUpdate(
    { ingredientName: res.value.ingredientName },
    res.value,
    { new: true, upsert: true }
  );
  return NextResponse.json({ ingredient }, { status: 201 });
}
