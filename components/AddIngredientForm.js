'use client'
import {Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, useDisclosure, Checkbox, Input, Link, Select, SelectItem, Tooltip} from "@nextui-org/react";
import UnitsInput from "./UnitsInput";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function AddIngredientForm() {

  const {isOpen, onOpen, onOpenChange} = useDisclosure();
  const [ingredientName,setIngredientName]=useState("");
  const [quantity,setQuantity]=useState("");
  const [cost,setCost]=useState("");
  const [units,setUnits]=useState(new Set([]));
  const router= useRouter();


  const handleSubmit = async (e) =>
  {
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
    if(!units)
    {
      alert("the unit has not been chosen")
      return ;
    }
    let unit;
    for(const item of units)
    {
        unit=item
    }
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
    }catch(e)
    {
      console.log(e);
    }
  }
  
  return (
    <>
      <Button onPress={onOpen} color="primary">Add Ingredient</Button>
      <Modal 
        isOpen={isOpen} 
        onOpenChange={onOpenChange}
        backdrop="blur"
        size="xl"
        placement="top-center"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Add Ingredient</ModalHeader>
                <form onSubmit={handleSubmit}>
              <ModalBody>
                    <div class="flex justify-between">
                      <Input
                        autoFocus
                        label="Ingredient Name"
                        labelPlacement="outside"
                        placeholder="Enter Ingredient Name"
                        variant="none"
                        value={ingredientName}
                        onValueChange={setIngredientName}
                      
                      />
                      <Input
                        label="Quanitity"
                        labelPlacement="outside"
                        placeholder="Enter quantity of ingredient used"
                        variant="none"
                        value={quantity}
                        onValueChange={setQuantity}
                      />
                      <UnitsInput unit={units} setUnit={setUnits} ></UnitsInput>
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

                    

                
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="flat" onPress={onClose}>
                  Close
                </Button>
                <Button color="primary"  type="submit" onPress={onClose}>
                  Add Ingredient
                </Button>
              </ModalFooter>
                </form>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
