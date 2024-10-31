import mongoose,{Schema} from "mongoose";
const ingredientSchema = new Schema(
    {
        ingredientName:String,
        quantity:Number,
        unit:String,
        cost:Number,

    },
    {
        timestamps:true,
    }
);
const Ingredient= mongoose.models.Ingredient|| mongoose.model("Ingredient",ingredientSchema)
export default Ingredient;