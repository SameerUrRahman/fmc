"use client";
import { Button, Card, CardBody, CardFooter, Chip, addToast } from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { recipeCost, formatINR } from "@/libs/units";
import { DeleteIcon } from "./DeleteIcon";

export default function RecipeList({ recipes }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const createRecipe = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New Recipe", servings: 1, overheadPct: 0, ingredients: [] }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "failed to create recipe");
      const { recipe } = await res.json();
      router.push(`/recipe/${recipe._id}`);
    } catch (e) {
      addToast({ title: "Couldn't create recipe", description: String(e.message), color: "danger" });
      setCreating(false);
    }
  };

  const deleteRecipe = async (recipe) => {
    if (!confirm(`Delete "${recipe.name}"? This can't be undone.`)) return;
    const res = await fetch(`/api/recipes/${recipe._id}`, { method: "DELETE" });
    if (res.ok) {
      addToast({ title: `Deleted "${recipe.name}"`, color: "success" });
      router.refresh();
    } else {
      addToast({ title: "Delete failed", color: "danger" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recipes</h1>
        <Button color="primary" onPress={createRecipe} isLoading={creating}>
          + New Recipe
        </Button>
      </div>

      {recipes.length === 0 && (
        <Card className="border border-dashed border-default-200 bg-transparent">
          <CardBody className="items-center gap-3 py-14 text-center">
            <span className="text-4xl">🍳</span>
            <p className="text-lg font-medium">No recipes yet</p>
            <p className="text-default-500 max-w-sm">
              Create your first recipe, add its ingredients, and see exactly what it costs to make.
            </p>
            <Button color="primary" onPress={createRecipe} isLoading={creating}>
              Create a recipe
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {recipes.map((recipe) => {
          const { total, perServing, lines } = recipeCost(recipe.ingredients, recipe);
          const broken = lines.filter((l) => l.error).length;
          return (
            <Card
              key={recipe._id}
              className="relative border border-default-100 hover:border-primary/60 hover:bg-content2 transition-colors"
            >
              <CardBody className="gap-1 p-5">
                <div className="flex items-start justify-between">
                  {/* after:inset-0 overlay makes the whole card the click target
                      without nesting the delete <button> inside another button */}
                  <Link
                    href={`/recipe/${recipe._id}`}
                    className="text-lg font-semibold after:absolute after:inset-0 after:z-0"
                  >
                    {recipe.name}
                  </Link>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    className="relative z-10"
                    aria-label={`Delete ${recipe.name}`}
                    onPress={() => deleteRecipe(recipe)}
                  >
                    <DeleteIcon />
                  </Button>
                </div>
                <p className="text-default-500 text-sm">
                  {recipe.ingredients.length} ingredient{recipe.ingredients.length === 1 ? "" : "s"} ·{" "}
                  {recipe.servings} serving{recipe.servings === 1 ? "" : "s"}
                </p>
              </CardBody>
              <CardFooter className="justify-between px-5 pb-4 pt-0">
                <div className="flex gap-2">
                  <Chip color="primary" variant="flat">{formatINR(total)} total</Chip>
                  <Chip variant="flat">{formatINR(perServing)} / serving</Chip>
                </div>
                {broken > 0 && (
                  <Chip color="warning" variant="flat" size="sm">
                    {broken} line{broken === 1 ? "" : "s"} need attention
                  </Chip>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
