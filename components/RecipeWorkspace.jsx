"use client";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Select,
  SelectItem,
  Tooltip,
  addToast,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QUANTITY_UNITS, PRICE_UNITS, lineCost, recipeCost, formatINR } from "@/libs/units";
import { DeleteIcon } from "./DeleteIcon";

const emptyLine = () => ({
  key: crypto.randomUUID(),
  ingredientName: "",
  quantity: "",
  unit: "g",
  price: "",
  priceUnit: "kg",
  knownIngredientId: undefined,
});

export default function RecipeWorkspace({ initialRecipe, knownIngredients }) {
  const router = useRouter();
  const [name, setName] = useState(initialRecipe.name);
  const [servings, setServings] = useState(String(initialRecipe.servings ?? 1));
  const [overheadPct, setOverheadPct] = useState(String(initialRecipe.overheadPct ?? 0));
  const [marginPct, setMarginPct] = useState("30");
  const [lines, setLines] = useState(() =>
    initialRecipe.ingredients.length > 0
      ? initialRecipe.ingredients.map((ing) => ({ ...ing, key: ing._id ?? crypto.randomUUID() }))
      : [emptyLine()]
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const patchLine = (key, patch) => {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  // Picking a known ingredient autofills its current price
  const pickKnown = (key, selectedName) => {
    const known = knownIngredients.find((k) => k.ingredientName === selectedName);
    if (known) {
      patchLine(key, {
        ingredientName: known.ingredientName,
        price: String(known.price),
        priceUnit: known.priceUnit,
        knownIngredientId: known._id,
      });
    } else if (selectedName != null) {
      patchLine(key, { ingredientName: String(selectedName), knownIngredientId: undefined });
    }
  };

  const addLine = () => {
    setDirty(true);
    setLines((prev) => [...prev, emptyLine()]);
  };

  const removeLine = (key) => {
    setDirty(true);
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const totals = useMemo(
    () =>
      recipeCost(
        lines.filter((l) => l.ingredientName.trim() !== ""),
        { servings: Number(servings) || 1, overheadPct: Number(overheadPct) || 0 }
      ),
    [lines, servings, overheadPct]
  );
  const suggestedPrice = totals.perServing * (1 + (Number(marginPct) || 0) / 100);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name,
        servings: Number(servings) || 1,
        overheadPct: Number(overheadPct) || 0,
        ingredients: lines
          .filter((l) => l.ingredientName.trim() !== "")
          .map(({ key, _id, ...rest }) => rest),
      };
      const res = await fetch(`/api/recipes/${initialRecipe._id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || "save failed");
      setDirty(false);
      addToast({ title: "Recipe saved", color: "success" });
      router.refresh();
    } catch (e) {
      addToast({ title: "Save failed", description: String(e.message), color: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <Input
          label="Recipe name"
          labelPlacement="outside"
          value={name}
          onValueChange={(v) => { setName(v); setDirty(true); }}
          className="max-w-xs"
        />
        <div className="flex gap-3">
          <Input
            type="number"
            min="1"
            label="Servings"
            labelPlacement="outside"
            value={servings}
            onValueChange={(v) => { setServings(v); setDirty(true); }}
            className="w-28"
          />
          <Tooltip content="Gas, electricity, packaging, labor — added on top of ingredient cost">
            <Input
              type="number"
              min="0"
              label="Overhead %"
              labelPlacement="outside"
              value={overheadPct}
              onValueChange={(v) => { setOverheadPct(v); setDirty(true); }}
              className="w-28"
            />
          </Tooltip>
        </div>
      </div>

      <Card>
        <CardBody className="gap-2">
          <div className="hidden sm:grid grid-cols-[1fr_90px_90px_90px_90px_90px_40px] gap-2 text-xs text-default-500 px-1">
            <span>INGREDIENT</span>
            <span>QTY</span>
            <span>UNIT</span>
            <span>PRICE ₹</span>
            <span>PER</span>
            <span className="text-right">COST</span>
            <span />
          </div>
          {lines.map((line) => {
            const { cost, error } = lineCost(line);
            const showError = error && line.ingredientName.trim() !== "" && line.quantity !== "" && line.price !== "";
            return (
              <div
                key={line.key}
                className="grid grid-cols-2 sm:grid-cols-[1fr_90px_90px_90px_90px_90px_40px] gap-2 items-center"
              >
                <Autocomplete
                  aria-label="Ingredient name"
                  placeholder="Ingredient"
                  allowsCustomValue
                  size="sm"
                  inputValue={line.ingredientName}
                  onInputChange={(v) => patchLine(line.key, { ingredientName: v, knownIngredientId: undefined })}
                  onSelectionChange={(sel) => pickKnown(line.key, sel)}
                  defaultItems={knownIngredients}
                  className="col-span-2 sm:col-span-1"
                >
                  {(item) => (
                    <AutocompleteItem key={item.ingredientName} textValue={item.ingredientName}>
                      <div className="flex justify-between gap-2">
                        <span>{item.ingredientName}</span>
                        <span className="text-default-400">
                          ₹{item.price}/{item.priceUnit}
                        </span>
                      </div>
                    </AutocompleteItem>
                  )}
                </Autocomplete>
                <Input
                  aria-label="Quantity"
                  type="number"
                  min="0"
                  placeholder="Qty"
                  size="sm"
                  value={String(line.quantity)}
                  onValueChange={(v) => patchLine(line.key, { quantity: v })}
                />
                <Select
                  aria-label="Unit"
                  size="sm"
                  selectedKeys={[line.unit]}
                  onSelectionChange={(keys) => {
                    const u = [...keys][0];
                    if (u) patchLine(line.key, { unit: u });
                  }}
                >
                  {QUANTITY_UNITS.map((u) => (
                    <SelectItem key={u}>{u}</SelectItem>
                  ))}
                </Select>
                <Input
                  aria-label="Price"
                  type="number"
                  min="0"
                  placeholder="Price"
                  size="sm"
                  value={String(line.price)}
                  onValueChange={(v) => patchLine(line.key, { price: v })}
                />
                <Select
                  aria-label="Price unit"
                  size="sm"
                  selectedKeys={[line.priceUnit]}
                  onSelectionChange={(keys) => {
                    const u = [...keys][0];
                    if (u) patchLine(line.key, { priceUnit: u });
                  }}
                >
                  {PRICE_UNITS.map((u) => (
                    <SelectItem key={u}>per {u}</SelectItem>
                  ))}
                </Select>
                <div className="text-right text-sm">
                  {showError ? (
                    <Tooltip content={error}>
                      <Chip color="warning" variant="flat" size="sm">!</Chip>
                    </Tooltip>
                  ) : (
                    <span className="font-medium">{formatINR(cost)}</span>
                  )}
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  color="danger"
                  aria-label="Remove line"
                  onPress={() => removeLine(line.key)}
                >
                  <DeleteIcon />
                </Button>
              </div>
            );
          })}
          <Button variant="flat" onPress={addLine} className="self-start">
            + Add ingredient
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-default-500">Ingredients</p>
              <p className="text-lg font-semibold">{formatINR(totals.subtotal)}</p>
            </div>
            <div>
              <p className="text-xs text-default-500">Overhead ({overheadPct || 0}%)</p>
              <p className="text-lg font-semibold">{formatINR(totals.overhead)}</p>
            </div>
            <div>
              <p className="text-xs text-default-500">Total cost</p>
              <p className="text-lg font-bold text-primary">{formatINR(totals.total)}</p>
            </div>
            <div>
              <p className="text-xs text-default-500">Per serving</p>
              <p className="text-lg font-semibold">{formatINR(totals.perServing)}</p>
            </div>
            <div className="flex items-end gap-2">
              <Input
                type="number"
                min="0"
                label="Margin %"
                labelPlacement="outside"
                size="sm"
                value={marginPct}
                onValueChange={setMarginPct}
                className="w-24"
              />
              <div>
                <p className="text-xs text-default-500">Sell / serving at</p>
                <p className="text-lg font-semibold text-success">{formatINR(suggestedPrice)}</p>
              </div>
            </div>
          </div>
          <Button color="primary" size="lg" onPress={save} isLoading={saving} isDisabled={!dirty}>
            {dirty ? "Save recipe" : "Saved"}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
