import EditIngredientForm from "@/components/EditIngredientForm";
const getIngredientById= async (id) =>{
    try{
        const res= await fetch(`http:localhost:3000/api/ingredients/${id}`,{
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
    const {id}=params;
    const {ingredient}= await getIngredientById(id);
    const {ingredientName,quantity,unit,cost}=ingredient;
    // console.log(ingredient);
    return (
        <>
        <EditIngredientForm id={id}ingredientName={ingredientName} quantity={quantity} unit={unit} cost={cost}></EditIngredientForm>
        </>
    )
}