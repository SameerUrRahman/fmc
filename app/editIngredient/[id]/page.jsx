import EditIngredientForm from "@/components/EditIngredientForm";
const getIngredientById= async (id) =>{
    try{
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
        const res= await fetch(`${apiUrl}/api/ingredients/${id}`,{
            cache:"no-store"
        })
        if(res.ok) return res.json();
    }catch(error)
    {
        console.log(error);
    }
}
export default async function EditIngredient({params})
{
    const {id}= await params;
    const ingredientData = await getIngredientById(id);
    
    if (!ingredientData || !ingredientData.ingredient) {
        return <div className="p-5">Ingredient not found</div>;
    }

    const {ingredientName,quantity,unit,cost}=ingredientData.ingredient;
    // console.log(ingredient);
    return (
        <>
        <EditIngredientForm id={id}ingredientName={ingredientName} quantity={quantity} unit={unit} cost={cost}></EditIngredientForm>
        </>
    )
}