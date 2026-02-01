"use client";
import { Input, Button, Autocomplete ,AutocompleteItem,AutocompleteSection, select} from "@nextui-org/react";
import { Tooltip } from "@nextui-org/react";
import { useEffect, useState,useRef } from "react";
import { useRouter } from "next/navigation";
import {allUnits,knownIngredients} from "./data";
export default function UpdatedAddIngredientForm() {
  const [ingredientName,setIngredientName]=useState("");
  const [quantity,setQuantity]=useState("");
  const [cost,setCost]=useState("");
  const [unit,setUnit]=useState("");
  const [allowedUnits,setAllowedUnits]=useState(allUnits);
  const newknownIngredients=useRef([]);
  const router= useRouter();
  useEffect(() => {
    const getIngredients = async () => {
      try{
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
        const response= await fetch(`${apiUrl}/api/knownIngredients`);
        if(!response.ok)
        {
          throw new Error("Failed to fetch ingredients");
        }
        const data = await response.json();
        console.log(data);
        newknownIngredients.current=data.ingredients;

        console.log(knownIngredients);
      }
      catch(e)
      {
        console.log("error loading ingredients:",e);
    }
  }
  getIngredients();
  }, []);
  const handleSubmit = async (e) =>
    {
      e.preventDefault();
      if(!ingredientName)
      {
          alert("Ingredient name is missing")
          return ;
      }
      if(!quantity)
      {
        alert("quantity is missing")
          return ;
      }
      if(!cost)
      {
        alert("cost  is missing")
          return; 
      }
      if(!unit)
      {
        alert("the unit has not been chosen")
        return ;
      }
      // let unit;
      // for(const item of units)
      // {
      //     unit=item
      // }
      try{
        // const unit=""
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
        const res= await fetch(`${apiUrl}/api/ingredients`,{
          method:"POST",
          headers:{
            "content-type":"application/json"
          },
          body:JSON.stringify({ingredientName,quantity,unit,cost}),
        });
        if(!res.ok)
        {
          
          throw new Error("failed to post ingredient");
        }
        router.push("/");
        router.refresh();
      }catch(e)
      {
        console.log(e);
      }
    }
  useEffect(  () => {
    let foundIngredient = knownIngredients.find((ingredient) => ingredient.ingredient === ingredientName);
    if(foundIngredient){
      setCost(Number(foundIngredient.cost));
      let foundIngredientUnits = allUnits.filter((unit) => unit.unitType.includes(foundIngredient.unitType));
      setAllowedUnits(foundIngredientUnits);
    }
    else{
      setCost(0);
      setAllowedUnits(allUnits);
    }
    // setDummy(prevDummy => !prevDummy);
},[ingredientName]);



  return (
    <div>
      <form className="p-5  rounded-lg w-full h-full flex flex-col items-center gap-2" onSubmit={handleSubmit}>
        <div className="flex justify-between">
            <Autocomplete 
              onKeyDown={(e) => e.continuePropagation()}
              label="Ingredient Name"
              labelPlacement="outside"
              placeholder="Enter Ingredient Name"
              variant="none"
              allowsCustomValue
              value={ingredientName}
              onValueChange={setIngredientName}
              defaultItems={knownIngredients}
              // defaultItems={newknownIngredients.current}
              onSelectionChange={setIngredientName}
              >
              {(item) => <AutocompleteItem key={item.ingredient}>{item.ingredient}</AutocompleteItem>}
              {/* {(item) => <AutocompleteItem key={item._id}>{item.ingredientName}</AutocompleteItem>} */}
            </Autocomplete>
            <Input
            label="Quanitity"
            labelPlacement="outside"
            placeholder="Enter quantity of ingredient used"
            variant="none"
            value={quantity}
            onValueChange={setQuantity}
            />
            {/* <UnitsInput unit={units} setUnit={setUnits} ></UnitsInput>  */}
            <Autocomplete
                // isDisabled={isknownIngredient}
                defaultItems={allowedUnits}
                label="Unit"
                labelPlacement="outside"
                placeholder="Enter Unit"
                variant="none"
                value={unit}
                // onSelectionChange={setIngredientFieldState.unit}
                onValueChange={setUnit}
                onSelectionChange={setUnit}
                selectedKey={allUnits.find((unit) => unit.value === unit)}
                onKeyDown={(e) => e.continuePropagation()}
                >
                {(unit) => <AutocompleteItem key={unit.value}>{unit.label}</AutocompleteItem>}
            </Autocomplete>  
            <Tooltip content="you can also enter per piece (for ex. 1 dozen of bannanas is 12rs)">
                <Input
                label="Cost"
                labelPlacement="outside"
                placeholder="Enter cost per kg/L"
                variant="none"
                value={cost}
                onValueChange={setCost}
                />
            </Tooltip>
        </div>
        <Button color="primary" type="submit" className="center">
          Add
        </Button>
      </form>
      
    </div>
  );
}
