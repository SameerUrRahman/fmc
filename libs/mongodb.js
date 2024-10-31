import mongoose from "mongoose";
import { SERVER_PROPS_EXPORT_ERROR } from "next/dist/lib/constants";
const connectMongoDB= async() => 
{
    try{
        await mongoose.connect(process.env.MONGODB_URI)
        console.log("Connected Succesfully")
    }
    catch(e){
        console.log(e);
    }
}
export default connectMongoDB;