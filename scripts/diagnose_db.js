import mongoose from "mongoose";
import connectMongoDB from "../libs/mongodb.js";
import Ingredient from "../models/Ingredient.js";
import dotenv from "dotenv";

dotenv.config({ path: '../.env' });

console.log("Testing MongoDB Connection...");
console.log("URI:", process.env.MONGODB_URI ? "Found (hidden)" : "MISSING");

async function test() {
    try {
        await connectMongoDB();
        console.log("Connection attempt finished.");
        
        console.log("State:", mongoose.connection.readyState); 
        // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting

        if (mongoose.connection.readyState === 1) {
            console.log("Attempting to find ingredients...");
            // Need to make sure Ingredient model is registered if not already
            const count = await Ingredient.countDocuments();
            console.log(`Found ${count} ingredients.`);
            const items = await Ingredient.find().limit(2);
            console.log("Sample items:", items);
        } else {
            console.error("Not connected to DB. State:", mongoose.connection.readyState);
        }

    } catch (error) {
        console.error("Test Failed:", error);
    } finally {
        await mongoose.disconnect();
    }
}

test();
