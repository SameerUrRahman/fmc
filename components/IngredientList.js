

import IngredientTable from "./IngredientTable";

const getIngredients=async() =>
{
  try{
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    console.log(`Fetching ingredients from: ${apiUrl}/api/ingredients`);
    const res= await fetch(`${apiUrl}/api/ingredients`,{
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
    return { ingredients: [] };
  }
  
}

export default   async  function IngredientList()
{
  const {ingredients}=await getIngredients();
  return (
   <IngredientTable users={ingredients}></IngredientTable>
    )

  
    
}