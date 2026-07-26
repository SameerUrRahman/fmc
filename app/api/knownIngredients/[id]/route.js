import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import { validateKnownIngredient } from "@/libs/validate";
import { updatePriceById } from "@/libs/prices";
import { NextResponse } from "next/server";

export async function PUT(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  const res = validateKnownIngredient(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  await connectMongoDB();
  // appends to PriceSnapshot as well — a hand-edited price is an observation
  const ingredient = await updatePriceById(id, res.value);
  if (!ingredient) {
    return NextResponse.json({ error: "ingredient not found" }, { status: 404 });
  }
  return NextResponse.json({ ingredient });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  await connectMongoDB();
  const ingredient = await KnownIngredients.findByIdAndDelete(id);
  if (!ingredient) {
    return NextResponse.json({ error: "ingredient not found" }, { status: 404 });
  }
  return NextResponse.json({ message: "ingredient deleted" });
}
