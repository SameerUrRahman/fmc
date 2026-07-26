import connectMongoDB from "@/libs/mongodb";
import KnownIngredients from "@/models/knownIngredient";
import PriceBook from "@/components/PriceBook";
import { getHistoryFor } from "@/libs/priceHistory";

export const dynamic = "force-dynamic";

export default async function PricesPage() {
  await connectMongoDB();
  const docs = await KnownIngredients.find().sort({ ingredientName: 1 }).lean();
  const ingredients = JSON.parse(JSON.stringify(docs));
  // observations are restated in each row's current price unit, so a unit
  // change in the price book doesn't chart as a price spike
  const history = await getHistoryFor(
    ingredients.map((i) => ({ ingredientName: i.ingredientName, priceUnit: i.priceUnit }))
  );
  return <PriceBook ingredients={ingredients} history={history} />;
}
