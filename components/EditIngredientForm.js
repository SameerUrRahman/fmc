"use client";
import { Input, Button } from "@nextui-org/react";
import UnitsInput from "./UnitsInput";
import { Tooltip } from "@nextui-org/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function EditIngredientForm({
  id,
  ingredientName,
  quantity,
  unit,
  cost,
}) {
  
  const [newIngredientName, setNewIngredientName] = useState(ingredientName);
  const [newQuantity, setNewQuantity] = useState(quantity);
  const [newCost, setNewCost] = useState(cost);
  const [newUnits, setNewUnits] = useState(new Set([unit]));
  const router = useRouter();


  const handleSubmit = async (e) => {
    console.log(e);
    e.preventDefault();
    let newUnit ;
    for(const item of newUnits)
    {
      newUnit=item;
    }

    try{
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
      const res=await fetch(`${apiUrl}/api/ingredients/${id}`,{
        method:"PUT",
        headers:{
          "Content-type":"application/json",
        },
        body:JSON.stringify({newIngredientName,newQuantity,newUnit,newCost})
      })
      if(!res.ok)
      {
        throw new Error("failed putting")
      }
      router.push("/");
      router.refresh();
    }
    catch(error)
    {
      console.log(error);
    }
  };

  

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="p-5  rounded-lg w-full h-full flex flex-col items-center gap-2"
      >
        <div className="flex justify-between">
          <Input
            autoFocus
            label="Ingredient Name"
            labelPlacement="outside"
            placeholder="Enter Ingredient Name"
            variant="none"
            value={newIngredientName}
            onValueChange={setNewIngredientName}
          />
          <Input
            label="Quanitity"
            labelPlacement="outside"
            placeholder="Enter quantity of ingredient used"
            variant="none"
            value={newQuantity}
            onValueChange={setNewQuantity}
          />
          <UnitsInput unit={newUnits} setUnit={setNewUnits}></UnitsInput>
          <Tooltip content="you can also enter per piece (for ex. 1 dozen of bannanas is 12rs)">
            <Input
              label="Cost"
              labelPlacement="outside"
              placeholder="Enter cost per kg/L"
              variant="none"
              value={newCost}
              onValueChange={setNewCost}
            />
          </Tooltip>
        </div>
        <Button color="primary" type="submit" className="center">
          Update
        </Button>
      </form>
    </>
  );
}
