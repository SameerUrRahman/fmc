import mongoose,{Schema} from "mongoose";
const knownIngredientSchema = new Schema(
    {
        ingredientName:String,
        unit:String,
        cost:Number,
        unitType:String,

    },
    {
        timestamps:true,
    }

);
const KnownIngredients= mongoose.models.KnownIngredients|| mongoose.model("KnownIngredients",knownIngredientSchema)
export default KnownIngredients;