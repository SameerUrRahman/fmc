import connectMongoDB from "@/libs/mongodb";
import Recipe from "@/models/Recipe";
import KnownIngredients from "@/models/knownIngredient";
import RecipeWorkspace from "@/components/RecipeWorkspace";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export default async function RecipePage({ params }) {
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return <div className="p-5">Recipe not found.</div>;
  }
  await connectMongoDB();
  const [recipeDoc, knownDocs] = await Promise.all([
    Recipe.findById(id).lean(),
    KnownIngredients.find().sort({ ingredientName: 1 }).lean(),
  ]);
  if (!recipeDoc) {
    return <div className="p-5">Recipe not found.</div>;
  }
  const recipe = JSON.parse(JSON.stringify(recipeDoc));
  const knownIngredients = JSON.parse(JSON.stringify(knownDocs));
  return <RecipeWorkspace initialRecipe={recipe} knownIngredients={knownIngredients} />;
}
