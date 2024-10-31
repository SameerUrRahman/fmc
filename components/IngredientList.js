

import IngredientTable from "./IngredientTable";

const getIngredients=async() =>
{
  try{
    const res= await fetch("http://localhost:3000/api/ingredients",{
      cache:"no-store"
    });
    if(!res.ok) 
    {
      throw new Error("Failed to fetch ingredients");
    }
    return res.json();
  }
  catch(e)
  {
    console.log("error loading ingredients:",e);
  }
  
}

export default   async  function IngredientList()
{
  const {ingredients}=await getIngredients();
  return (
   <IngredientTable users={ingredients}></IngredientTable>
    )

  
    
}