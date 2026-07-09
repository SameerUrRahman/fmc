"use client";
import {
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRICE_UNITS } from "@/libs/units";
import { DeleteIcon } from "./DeleteIcon";

function staleness(fetchedAt) {
  if (!fetchedAt) return { label: "never updated", color: "danger" };
  const days = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 86400000);
  if (days <= 7) return { label: days === 0 ? "today" : `${days}d ago`, color: "success" };
  if (days <= 30) return { label: `${days}d ago`, color: "warning" };
  return { label: `${days}d ago`, color: "danger" };
}

export default function PriceBook({ ingredients }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newUnit, setNewUnit] = useState("kg");
  const [busy, setBusy] = useState(false);
  // per-row edit buffer: { [id]: { price, priceUnit } }
  const [edits, setEdits] = useState({});

  const addIngredient = async () => {
    if (!newName.trim() || newPrice === "") {
      addToast({ title: "Name and price are required", color: "warning" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/knownIngredients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ingredientName: newName, price: newPrice, priceUnit: newUnit, source: "manual" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "failed");
      setNewName("");
      setNewPrice("");
      addToast({ title: `Saved price for ${newName}`, color: "success" });
      router.refresh();
    } catch (e) {
      addToast({ title: "Couldn't save", description: String(e.message), color: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const saveRow = async (ing) => {
    const edit = edits[ing._id];
    if (!edit) return;
    const res = await fetch(`/api/knownIngredients/${ing._id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ingredientName: ing.ingredientName,
        price: edit.price ?? ing.price,
        priceUnit: edit.priceUnit ?? ing.priceUnit,
        source: "manual",
      }),
    });
    if (res.ok) {
      setEdits((prev) => {
        const { [ing._id]: _, ...rest } = prev;
        return rest;
      });
      addToast({ title: `Updated ${ing.ingredientName}`, color: "success" });
      router.refresh();
    } else {
      addToast({ title: "Update failed", color: "danger" });
    }
  };

  const deleteRow = async (ing) => {
    if (!confirm(`Remove "${ing.ingredientName}" from the price book?`)) return;
    const res = await fetch(`/api/knownIngredients/${ing._id}`, { method: "DELETE" });
    if (res.ok) {
      addToast({ title: `Removed ${ing.ingredientName}`, color: "success" });
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Price Book</h1>
        <p className="text-default-500 text-sm">
          Current market prices used to autofill recipes. Update by hand or via the price-sync scripts.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          label="Ingredient"
          labelPlacement="outside"
          placeholder="e.g. sugar"
          value={newName}
          onValueChange={setNewName}
          className="max-w-48"
          size="sm"
        />
        <Input
          label="Price ₹"
          labelPlacement="outside"
          placeholder="e.g. 45"
          type="number"
          min="0"
          value={newPrice}
          onValueChange={setNewPrice}
          className="w-28"
          size="sm"
        />
        <Select
          label="Per"
          labelPlacement="outside"
          selectedKeys={[newUnit]}
          onSelectionChange={(keys) => setNewUnit([...keys][0] ?? "kg")}
          className="w-28"
          size="sm"
          aria-label="Price unit"
        >
          {PRICE_UNITS.map((u) => (
            <SelectItem key={u}>{u}</SelectItem>
          ))}
        </Select>
        <Button color="primary" onPress={addIngredient} isLoading={busy} size="sm" className="h-8">
          Add / update
        </Button>
      </div>

      <Table aria-label="Price book">
        <TableHeader>
          <TableColumn>INGREDIENT</TableColumn>
          <TableColumn>PRICE</TableColumn>
          <TableColumn>PER</TableColumn>
          <TableColumn>SOURCE</TableColumn>
          <TableColumn>UPDATED</TableColumn>
          <TableColumn align="center">ACTIONS</TableColumn>
        </TableHeader>
        <TableBody items={ingredients} emptyContent="No prices yet — add your staples above, or run the seed script.">
          {(ing) => {
            const edit = edits[ing._id] ?? {};
            const stale = staleness(ing.fetchedAt);
            const isEdited = edits[ing._id] !== undefined;
            return (
              <TableRow key={ing._id}>
                <TableCell>{ing.ingredientName}</TableCell>
                <TableCell>
                  <Input
                    aria-label={`Price of ${ing.ingredientName}`}
                    type="number"
                    min="0"
                    size="sm"
                    value={String(edit.price ?? ing.price)}
                    onValueChange={(v) =>
                      setEdits((prev) => ({ ...prev, [ing._id]: { ...prev[ing._id], price: v } }))
                    }
                    startContent={<span className="text-default-400">₹</span>}
                    className="w-28"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    aria-label={`Price unit of ${ing.ingredientName}`}
                    size="sm"
                    selectedKeys={[edit.priceUnit ?? ing.priceUnit]}
                    onSelectionChange={(keys) => {
                      const u = [...keys][0];
                      if (u)
                        setEdits((prev) => ({ ...prev, [ing._id]: { ...prev[ing._id], priceUnit: u } }));
                    }}
                    className="w-24"
                  >
                    {PRICE_UNITS.map((u) => (
                      <SelectItem key={u}>{u}</SelectItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat">{ing.source || "manual"}</Chip>
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color={stale.color}>{stale.label}</Chip>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <Button size="sm" variant="flat" color="primary" isDisabled={!isEdited} onPress={() => saveRow(ing)}>
                      Save
                    </Button>
                    <Button isIconOnly size="sm" variant="light" color="danger" aria-label={`Delete ${ing.ingredientName}`} onPress={() => deleteRow(ing)}>
                      <DeleteIcon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          }}
        </TableBody>
      </Table>
    </div>
  );
}
