import connectMongoDB from "@/libs/mongodb";
import Recipe from "@/models/Recipe";
import RecipeList from "@/components/RecipeList";

export const dynamic = "force-dynamic";

export default async function Home() {
  await connectMongoDB();
  const docs = await Recipe.find().sort({ updatedAt: -1 }).lean();
  const recipes = JSON.parse(JSON.stringify(docs));
  return <RecipeList recipes={recipes} />;
}
