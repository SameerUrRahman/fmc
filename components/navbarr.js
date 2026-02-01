'use client'
import { Link } from "@nextui-org/react";
import AddIngredientForm from "./AddIngredientForm";
import { Navbar,NavbarItem } from "@nextui-org/react";
import UpdatedAddIngredientForm from "./UpdatedAddIngredientForm";

export default function Navbarr()
{
    return(
        <Navbar isBordered >
            <NavbarItem>
                <Link className="text-primary  font-bold" href={"/"}>FMC</Link>
            </NavbarItem>

            <NavbarItem>
                {/* <AddIngredientForm></AddIngredientForm> */}
                <Link href="/addIngredient"  > Add Ingredient</Link>
                {/* <UpdatedAddIngredientForm></UpdatedAddIngredientForm> */}
                

            </NavbarItem>
            {/* <Link className=" p-2 " color="foreground" href={"/addIngredient"}>Add Ingredient</Link> */}
        </Navbar>
    );
}