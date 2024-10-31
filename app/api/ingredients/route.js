import { knownIngredients } from "@/components/data";
import connectMongoDB from "@/libs/mongodb";
import Ingredient from "@/models/Ingredient";
import { NextResponse } from "next/server";

export async function POST(request)
{
    const {ingredientName,quantity,unit,cost} = await request.json();
    await connectMongoDB();
    await Ingredient.create({ingredientName,quantity,unit,cost});
    return NextResponse.json({message:"successfully created new ingredient",status:201});

}
export async function GET(){
    await connectMongoDB();
    const ingredients=await Ingredient.find();
    return NextResponse.json({
        ingredients
    })
}
export async function DELETE(request)
{
    const id=request.nextUrl.searchParams.get("id");
    await connectMongoDB();
    await Ingredient.findByIdAndDelete(id);
    return NextResponse.json({message:"ingredient deleted successfully "},{status:200});
}
