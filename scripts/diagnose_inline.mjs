import mongoose from "mongoose";
import fs from "fs";
import path from "path";

// Manual .env parser
const envPath = path.resolve('.env');
try {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2 && !line.startsWith('#')) {
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            process.env[key] = val;
        }
    });
    console.log("Loaded .env manually.");
} catch (e) {
    console.log("Could not read .env:", e.message);
}

const Schema = mongoose.Schema;
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

const Ingredient = mongoose.models.Ingredient || mongoose.model("Ingredient", ingredientSchema);

const connectMongoDB = async() => 
{
    try{
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI is not defined in env");
        }
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected Succesfully (Script)");
    }
    catch(e){
        console.log("Connection Error:", e);
        throw e;
    }
}

async function test() {
    console.log("Starting diagnostic test...");
    try {
        await connectMongoDB();
        console.log("DB State:", mongoose.connection.readyState);

        const count = await Ingredient.countDocuments();
        console.log(`Document Count: ${count}`);
        
        const items = await Ingredient.find().limit(2);
        console.log("Found items:", items);

    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        await mongoose.disconnect();
    }
}

test();
