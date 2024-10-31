import connectMongoDB from "@/libs/mongodb";
import { NextResponse } from "next/server";
import Ingredient from "@/models/Ingredient";
export async function PUT(request,{params})
{
    const {id}= params;
    // const {newIngredientName:ingredientName,newQuantity:quantity,newUnit:unit,newCost:cost} = await request.json();
    const {newIngredientName:ingredientName,newQuantity:quantity,newUnit:unit,newCost:cost} = await request.json();
    await connectMongoDB();
    await Ingredient.findByIdAndUpdate(id,{ingredientName,quantity,unit,cost});
    return NextResponse.json({message:"successfully updated  ingredient",status:201});
}
export async function GET(request,{params})
{
    const {id}=params;
    await connectMongoDB
    const ingredient=await Ingredient.findOne({_id:id});
    return NextResponse.json({ingredient},{status:200}); 
}