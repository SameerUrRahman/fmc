import mongoose, { Schema } from "mongoose";

const recipeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      default: "My Recipe",
    },
    servings: {
      type: Number,
      min: 1,
      default: 1,
    },
    // packaging / gas / labor etc., as % on top of ingredient cost
    overheadPct: {
      type: Number,
      min: 0,
      max: 500,
      default: 0,
    },
    ingredients: [
      {
        ingredientName: { type: String, required: true, trim: true },
        quantity: { type: Number, required: true, min: 0 },
        unit: { type: String, required: true },
        // price per priceUnit (e.g. 30 per kg)
        price: { type: Number, required: true, min: 0 },
        priceUnit: { type: String, required: true, default: "kg" },
        knownIngredientId: {
          type: Schema.Types.ObjectId,
          ref: "KnownIngredients",
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Recipe = mongoose.models.Recipe || mongoose.model("Recipe", recipeSchema);
export default Recipe;
