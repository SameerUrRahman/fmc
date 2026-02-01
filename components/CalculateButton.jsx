import { Button } from "@nextui-org/react"
export default function CalculateButton({users})
{
    const calCost = ()=>
    {
        console.log(users);
        let sum=0;
        users.forEach(item =>
            {
                sum+=item.cost*item.quantity;
            });
        alert("The Cost for this recipe is " + "$ "+sum)

    }
    return(
        <Button  size="lg" color="primary" onClick={calCost} variant="shadow">calculate cost </Button>
    )
}
