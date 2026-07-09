import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import PriceBook from "@/components/PriceBook";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  await connectMongoDB();
  const docs = await KnownIngredients.find().sort({ ingredientName: 1 }).lean();
  const ingredients = JSON.parse(JSON.stringify(docs));
  return <PriceBook ingredients={ingredients} />;
}
