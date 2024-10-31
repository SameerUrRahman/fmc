import connectMongoDB from "@/libs/mongodb";
import { NextResponse } from "next/server";
import KnownIngredients from "@/models/knownIngredient";
export async function POST(request) {
    const {ingredientName,unit,cost,unitType} = await request.json();
    await connectMongoDB();
    await KnownIngredients.create({ingredientName,unit,cost,unitType});
    return NextResponse.json({message:"successfully created new ingredient in known ingredient ",status:201});
}
export async function GET(){
    await connectMongoDB();
    const ingredients=await KnownIngredients.find();
    return NextResponse.json({
        ingredients
    })
}
