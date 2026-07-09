import connectMongoDB from "@/libs/mongodb";
import Recipe from "@/models/Recipe";
import { validateRecipe } from "@/libs/validate";
import { NextResponse } from "next/server";

export async function GET() {
  await connectMongoDB();
  const recipes = await Recipe.find().sort({ updatedAt: -1 });
  return NextResponse.json({ recipes });
}

export async function POST(request) {
  const body = await request.json();
  const res = validateRecipe(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  await connectMongoDB();
  const recipe = await Recipe.create(res.value);
  return NextResponse.json({ recipe }, { status: 201 });
}
