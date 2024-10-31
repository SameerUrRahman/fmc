'use client'
import React from "react";
import {Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, User, Chip, Tooltip, getKeyValue, table, Button} from "@nextui-org/react";
import {EditIcon} from "./EditIcon";
import {DeleteIcon} from "./DeleteIcon";
import {columns} from "./data";
import CalculateButton from "./CalculateButton";
import Link from "next/link";
import RemoveBtn from "./RemoveBtn";
export default function IngredientTable({users})
{
    const renderCell = React.useCallback((user, columnKey) => {
        const cellValue = user[columnKey];
    
        switch (columnKey) {
        
         case "cost":
          return (
            <>
            {/* <span style='font-family:Arial;'>&#8377;</span> */}
            <p>₹{cellValue}  </p> 
            </>
          )
          case "actions":
            return (
              <div className=" relative flex m-1  items-center gap-2  ">
                {/* <Tooltip content="Details">
                    <span className="text-lg text-default-400 cursor-pointer active:opacity-50">
                      <EyeIcon />
                    </span>
                </Tooltip> */}
                <Tooltip content="Edit user">
                  <span className="text-lg text-default-400 cursor-pointer active:opacity-50 ">
                    <Link href={`/editIngredient/${user._id}`}>
                      <EditIcon></EditIcon>
                    </Link>
                  </span>
                </Tooltip>
                <Tooltip color="danger" content="Delete user">
                  {/* <span className="text-lg text-danger cursor-pointer active:opacity-50"> */}
                    <RemoveBtn id={user._id}></RemoveBtn>
                  {/* </span> */}
                </Tooltip>
              </div>
            );
          default:
            return cellValue;
        }
      }, []);
    
      return (
        <>
      <Table aria-label="Table with ingredients, ">
          <TableHeader columns={columns}>
            {(column) => (
              <TableColumn key={column.uid} align={column.uid === "actions" ? "center" : "start"}  >

                {column.name}
              </TableColumn>
            )}
          </TableHeader>
          <TableBody items={users} emptyContent={'No ingredients to display'}>
            {(item) => (
              <TableRow key={item._id}>
                {(columnKey) => <TableCell>{renderCell(item, columnKey)}</TableCell>}
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex justify-center gap-2">
          <CalculateButton   users={users} > </CalculateButton>
        </div>
        </>
      );
}