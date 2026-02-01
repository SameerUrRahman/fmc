import mongoose, { Schema } from "mongoose";

const recipeSchema = new Schema(
  {
    name: {
      type: String,
      default: "My Recipe",
    },
    ingredients: [
      {
        ingredientName: String,
        quantity: Number,
        unit: String,
        cost: Number,
        // Linking to KnownIngredient is optional for now, but good practice
        knownIngredientId: {
          type: Schema.Types.ObjectId,
          ref: "KnownIngredients",
        },
      },
    ],
    totalCost: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const Recipe = mongoose.models.Recipe || mongoose.model("Recipe", recipeSchema);
export default Recipe;
