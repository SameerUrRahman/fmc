"use client";
import { useRouter } from "next/navigation";
import { DeleteIcon } from "./DeleteIcon";
// import { Button } from "@nextui-org/react";
export default function RemoveBtn({id})
{
    const router=useRouter();
    const RemoveIngredient=async () => {
        {
            const res= await fetch(`/api/ingredients?id=${id}`,{
                method:"DELETE"
            })
            if(res.ok) router.refresh();
        }
    }
    return(
        <button onClick={RemoveIngredient}>
            <span className="text-lg text-danger cursor-pointer active:opacity-50">

            <DeleteIcon></DeleteIcon>
            </span>
        </button>
    )
}