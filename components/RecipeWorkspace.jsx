"use client";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Select,
  SelectItem,
  Slider,
  Tab,
  Tabs,
  Tooltip,
  addToast,
  useDisclosure,
} from "@heroui/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QUANTITY_UNITS, PRICE_UNITS, lineCost, recipeCost, formatINR } from "@/libs/units";
import { DeleteIcon } from "./DeleteIcon";
import ImportIngredientsModal from "./ImportIngredientsModal";
import CostBreakdown from "./CostBreakdown";
import CostOverTime from "./CostOverTime";
import WhatIfPanel from "./WhatIfPanel";

const emptyLine = () => ({
  key: crypto.randomUUID(),
  ingredientName: "",
  quantity: "",
  unit: "g",
  price: "",
  priceUnit: "kg",
  knownIngredientId: undefined,
});

const inputClasses = {
  inputWrapper: "bg-content2 data-[hover=true]:bg-content3 group-data-[focus=true]:bg-content3",
};
const selectClasses = {
  trigger: "bg-content2 data-[hover=true]:bg-content3",
};

function SummaryRow({ label, value, strong, color }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-default-500">{label}</span>
      <span className={`${strong ? "text-xl font-bold" : "text-medium font-semibold"} ${color ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

export default function RecipeWorkspace({ initialRecipe, knownIngredients, history = {} }) {
  const router = useRouter();
  const [name, setName] = useState(initialRecipe.name);
  const [servings, setServings] = useState(String(initialRecipe.servings ?? 1));
  const [overheadPct, setOverheadPct] = useState(String(initialRecipe.overheadPct ?? 0));
  const [marginPct, setMarginPct] = useState(30);
  // reverse pricing: a price you already have in mind, read back as a margin
  const [targetPrice, setTargetPrice] = useState("");
  const [lines, setLines] = useState(() =>
    initialRecipe.ingredients.length > 0
      ? initialRecipe.ingredients.map((ing) => ({ ...ing, key: ing._id ?? crypto.randomUUID() }))
      : [emptyLine()]
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const importModal = useDisclosure();

  const importLines = (newLines, source = null) => {
    setDirty(true);
    setLines((prev) => [
      ...prev.filter((l) => l.ingredientName.trim() !== ""),
      ...newLines.map((l) => ({ ...l, key: crypto.randomUUID() })),
    ]);
    // A URL import knows the recipe's own name and yield. Only adopt them when
    // the user hasn't set anything themselves — an import adds ingredients, it
    // doesn't get to rename a recipe or overwrite a considered serving count.
    if (source?.title && name.trim() === "New Recipe") setName(source.title);
    if (source?.servings && servings === "1") setServings(String(source.servings));
    router.refresh(); // pick up any price-book entries the import created
  };

  const patchLine = (key, patch) => {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

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
  const suggestedPrice = totals.perServing * (1 + marginPct / 100);

  const activeLines = useMemo(
    () => lines.filter((l) => l.ingredientName.trim() !== ""),
    [lines]
  );

  // Reverse pricing: given a sell price, what margin does it actually leave,
  // and what is the most an ingredient basket can cost to still hit it?
  const reverse = useMemo(() => {
    const target = Number(targetPrice);
    if (!Number.isFinite(target) || target <= 0 || totals.perServing <= 0) return null;
    const overheadMultiplier = 1 + (Number(overheadPct) || 0) / 100;
    return {
      marginPct: ((target - totals.perServing) / totals.perServing) * 100,
      // strip overhead back out to get the ingredient budget the price implies
      maxIngredientCost: (target * (Number(servings) || 1)) / overheadMultiplier,
    };
  }, [targetPrice, totals.perServing, overheadPct, servings]);

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
    <div className="flex flex-col gap-6">
      {/* header: back link + editable title */}
      <div className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-default-500 hover:text-primary w-fit">
          ← All recipes
        </Link>
        <Input
          aria-label="Recipe name"
          variant="underlined"
          size="lg"
          value={name}
          onValueChange={(v) => { setName(v); setDirty(true); }}
          classNames={{ input: "text-3xl font-bold", inputWrapper: "border-b-1 border-default-200" }}
          className="max-w-xl"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        {/* ingredients */}
        <Card className="border border-default-100">
          <CardHeader className="flex justify-between px-5 pt-4 pb-0">
            <h2 className="text-lg font-semibold">Ingredients</h2>
            <span className="text-sm text-default-400 hidden sm:inline">
              prices autofill from your <Link href="/prices" className="text-primary">price book</Link>
            </span>
          </CardHeader>
          <CardBody className="gap-4 p-5">
            {lines.map((line, i) => {
              const { cost, error } = lineCost(line);
              const showError =
                error && line.ingredientName.trim() !== "" && line.quantity !== "" && line.price !== "";
              return (
                <div key={line.key} className="flex flex-col gap-2">
                  {i > 0 && <Divider className="bg-default-100" />}
                  <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_170px_170px_auto] gap-x-3 gap-y-2 items-end">
                    <Autocomplete
                      label={i === 0 ? "Ingredient" : undefined}
                      aria-label="Ingredient name"
                      labelPlacement="outside"
                      placeholder="Start typing…"
                      allowsCustomValue
                      size="sm"
                      inputValue={line.ingredientName}
                      onInputChange={(v) => patchLine(line.key, { ingredientName: v, knownIngredientId: undefined })}
                      onSelectionChange={(sel) => pickKnown(line.key, sel)}
                      defaultItems={knownIngredients}
                      inputProps={{ classNames: inputClasses }}
                      className="col-span-2 md:col-span-1"
                    >
                      {(item) => (
                        <AutocompleteItem key={item.ingredientName} textValue={item.ingredientName}>
                          <div className="flex justify-between gap-2">
                            <span>{item.ingredientName}</span>
                            <span className="text-default-400">₹{item.price}/{item.priceUnit}</span>
                          </div>
                        </AutocompleteItem>
                      )}
                    </Autocomplete>

                    <div className="flex gap-1 items-end">
                      <Input
                        label={i === 0 ? "Quantity" : undefined}
                        aria-label="Quantity"
                        labelPlacement="outside"
                        type="number"
                        min="0"
                        placeholder="0"
                        size="sm"
                        value={String(line.quantity)}
                        onValueChange={(v) => patchLine(line.key, { quantity: v })}
                        classNames={inputClasses}
                        className="w-20"
                      />
                      <Select
                        aria-label="Unit"
                        size="sm"
                        selectedKeys={[line.unit]}
                        onSelectionChange={(keys) => {
                          const u = [...keys][0];
                          if (u) patchLine(line.key, { unit: u });
                        }}
                        classNames={selectClasses}
                        className="w-24"
                      >
                        {QUANTITY_UNITS.map((u) => (
                          <SelectItem key={u}>{u}</SelectItem>
                        ))}
                      </Select>
                    </div>

                    <div className="flex gap-1 items-end">
                      <Input
                        label={i === 0 ? "Price" : undefined}
                        aria-label="Price"
                        labelPlacement="outside"
                        type="number"
                        min="0"
                        placeholder="0"
                        size="sm"
                        startContent={<span className="text-default-400 text-sm">₹</span>}
                        value={String(line.price)}
                        onValueChange={(v) => patchLine(line.key, { price: v })}
                        classNames={inputClasses}
                        className="w-24"
                      />
                      <Select
                        aria-label="Price unit"
                        size="sm"
                        selectedKeys={[line.priceUnit]}
                        onSelectionChange={(keys) => {
                          const u = [...keys][0];
                          if (u) patchLine(line.key, { priceUnit: u });
                        }}
                        classNames={selectClasses}
                        className="w-24"
                        renderValue={(items) => <span>/{items[0]?.key}</span>}
                      >
                        {PRICE_UNITS.map((u) => (
                          <SelectItem key={u}>per {u}</SelectItem>
                        ))}
                      </Select>
                    </div>

                    <div className="flex items-center gap-1 justify-end min-w-[110px] h-8">
                      {showError ? (
                        <Tooltip content={error} color="warning">
                          <Chip color="warning" variant="flat" size="sm">can't cost</Chip>
                        </Tooltip>
                      ) : (
                        <span className="font-semibold tabular-nums w-20 text-right">
                          {formatINR(cost)}
                        </span>
                      )}
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
                  </div>
                </div>
              );
            })}
            <div className="flex gap-2">
              <Button variant="flat" color="primary" onPress={addLine}>
                + Add ingredient
              </Button>
              <Button variant="flat" onPress={importModal.onOpen}>
                ⇣ Import from text or URL
              </Button>
            </div>
            <ImportIngredientsModal
              isOpen={importModal.isOpen}
              onOpenChange={importModal.onOpenChange}
              onImport={importLines}
            />
          </CardBody>
        </Card>

        {/* sticky cost summary */}
        <Card className="border border-default-100 lg:sticky lg:top-20">
          <CardHeader className="px-5 pt-4 pb-0">
            <h2 className="text-lg font-semibold">Cost</h2>
          </CardHeader>
          <CardBody className="gap-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                min="1"
                label="Servings"
                labelPlacement="outside"
                size="sm"
                value={servings}
                onValueChange={(v) => { setServings(v); setDirty(true); }}
                classNames={inputClasses}
              />
              <Tooltip content="Gas, electricity, packaging, labor — added on top of ingredients">
                <Input
                  type="number"
                  min="0"
                  label="Overhead %"
                  labelPlacement="outside"
                  size="sm"
                  value={overheadPct}
                  onValueChange={(v) => { setOverheadPct(v); setDirty(true); }}
                  classNames={inputClasses}
                />
              </Tooltip>
            </div>

            <Divider className="bg-default-100" />

            <div className="flex flex-col gap-2">
              <SummaryRow label="Ingredients" value={formatINR(totals.subtotal)} />
              <SummaryRow label={`Overhead (${overheadPct || 0}%)`} value={formatINR(totals.overhead)} />
              <SummaryRow label="Total cost" value={formatINR(totals.total)} strong color="text-primary" />
              <SummaryRow label="Per serving" value={formatINR(totals.perServing)} />
            </div>

            <Divider className="bg-default-100" />

            <Slider
              label="Profit margin"
              size="sm"
              minValue={0}
              maxValue={150}
              step={5}
              value={marginPct}
              onChange={setMarginPct}
              getValue={(v) => `${v}%`}
              className="max-w-full"
            />
            <SummaryRow
              label="Sell each serving at"
              value={formatINR(suggestedPrice)}
              strong
              color="text-success"
            />

            <Divider className="bg-default-100" />

            {/* the same relationship read backwards: price in, margin out */}
            <Input
              type="number"
              min="0"
              label="…or price it at"
              labelPlacement="outside"
              size="sm"
              placeholder="target ₹ / serving"
              startContent={<span className="text-default-400 text-sm">₹</span>}
              value={targetPrice}
              onValueChange={setTargetPrice}
              classNames={inputClasses}
            />
            {reverse && (
              <div className="flex flex-col gap-1">
                <SummaryRow
                  label="Margin that leaves"
                  value={`${reverse.marginPct >= 0 ? "+" : ""}${reverse.marginPct.toFixed(0)}%`}
                  color={reverse.marginPct < 0 ? "text-danger" : "text-success"}
                />
                <SummaryRow
                  label="Ingredient budget"
                  value={formatINR(reverse.maxIngredientCost)}
                />
                <p className="text-default-400 text-xs">
                  {reverse.marginPct < 0
                    ? "Below cost at this price."
                    : `Ingredients can cost up to ${formatINR(reverse.maxIngredientCost)} total and still hit it.`}
                </p>
              </div>
            )}

            <Button color="primary" size="lg" onPress={save} isLoading={saving} isDisabled={!dirty} fullWidth>
              {dirty ? "Save recipe" : "Saved ✓"}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* analysis over the price history behind this recipe */}
      <Card className="border border-default-100">
        <CardBody className="p-5">
          <Tabs aria-label="Cost analysis" variant="underlined" classNames={{ panel: "pt-4" }}>
            <Tab key="breakdown" title="Breakdown">
              <CostBreakdown lines={activeLines} subtotal={totals.subtotal} />
            </Tab>
            <Tab key="trend" title="Cost over time">
              <CostOverTime
                lines={activeLines}
                history={history}
                servings={Number(servings) || 1}
                overheadPct={Number(overheadPct) || 0}
              />
            </Tab>
            <Tab key="whatif" title="What if">
              <WhatIfPanel
                lines={activeLines}
                history={history}
                servings={servings}
                overheadPct={overheadPct}
                baseTotal={totals.total}
              />
            </Tab>
          </Tabs>
        </CardBody>
      </Card>
    </div>
  );
}
