import { Select ,SelectItem, SelectSection} from "@nextui-org/react";
import { unitsMultiple, unitsVolume,unitsWeight } from "./data";
export default function UnitsInput({unit,setUnit})
{
    
    return(
        <Select
        label="Unit"
        labelPlacement="outside"
        placeholder="Enter Unit"
        variant="none"
        selectedKeys={unit}
        onSelectionChange={setUnit}
        > 
            <SelectSection showDivider title={"Volume Units"}>
                {unitsVolume.map((unit) => (
                    <SelectItem key={unit.value} value={unit.value}>
                        {unit.label}
                    </SelectItem>
                ))}
            </SelectSection>
            <SelectSection showDivider title={"Weights Units"}>
                {unitsWeight.map((unit) => (
                    <SelectItem key={unit.value} value={unit.value}>
                        {unit.label}
                    </SelectItem>
                ))}
            </SelectSection>
            <SelectSection showDivider title={"Multiples"}>
                {unitsMultiple.map((unit) => (
                    <SelectItem key={unit.value} value={unit.value}>
                        {unit.label}
                    </SelectItem>
                ))}
            </SelectSection>
        </Select>
    )
}