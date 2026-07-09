import connectMongoDB from "@/libs/mongodb";
import Recipe from "@/models/Recipe";
import { validateRecipe } from "@/libs/validate";
import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const { id } = await params;
  await connectMongoDB();
  const recipe = await Recipe.findById(id);
  if (!recipe) {
    return NextResponse.json({ error: "recipe not found" }, { status: 404 });
  }
  return NextResponse.json({ recipe });
}

export async function PUT(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  const res = validateRecipe(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  await connectMongoDB();
  const recipe = await Recipe.findByIdAndUpdate(id, res.value, { new: true });
  if (!recipe) {
    return NextResponse.json({ error: "recipe not found" }, { status: 404 });
  }
  return NextResponse.json({ recipe });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  await connectMongoDB();
  const recipe = await Recipe.findByIdAndDelete(id);
  if (!recipe) {
    return NextResponse.json({ error: "recipe not found" }, { status: 404 });
  }
  return NextResponse.json({ message: "recipe deleted" });
}
