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
  Tooltip,
  addToast,
  useDisclosure,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRICE_UNITS } from "@/libs/units";
import { DeleteIcon } from "./DeleteIcon";
import Sparkline from "./Sparkline";
import LogPurchaseModal from "./LogPurchaseModal";

function staleness(fetchedAt) {
  if (!fetchedAt) return { label: "never updated", color: "danger" };
  const days = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 86400000);
  if (days <= 7) return { label: days === 0 ? "today" : `${days}d ago`, color: "success" };
  if (days <= 30) return { label: `${days}d ago`, color: "warning" };
  return { label: `${days}d ago`, color: "danger" };
}

export default function PriceBook({ ingredients, history = {}, wanted = [] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newUnit, setNewUnit] = useState("kg");
  const [busy, setBusy] = useState(false);
  // per-row edit buffer: { [id]: { price, priceUnit } }
  const [edits, setEdits] = useState({});
  // which row has a lookup in flight, so only that button spins
  const [lookingUp, setLookingUp] = useState(null);
  const purchaseModal = useDisclosure();
  const [purchasePreset, setPurchasePreset] = useState("");
  const trendable = ingredients.filter((i) => history[i.ingredientName]?.stats?.enough).length;

  const openPurchase = (name = "") => {
    setPurchasePreset(name);
    purchaseModal.onOpen();
  };

  // Item 6. Explicit user action only — never call this from onValueChange.
  // The free tier is 30 req/min and an autocomplete would burn it in seconds.
  const lookUp = async (ing) => {
    setLookingUp(ing._id);
    try {
      const res = await fetch("/api/prices/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ingredientName: ing.ingredientName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "lookup failed");
      if (data.ok) {
        addToast({
          title: `${ing.ingredientName}: ₹${data.price}/${data.priceUnit}`,
          description: data.detail,
          // an estimate is a guess wearing a price's clothes — colour it differently
          color: data.source === "llm-estimate" ? "warning" : "success",
        });
      } else {
        addToast({
          title: `Couldn't price ${ing.ingredientName}`,
          description: [data.reason, data.detail].filter(Boolean).join(" — "),
          color: "warning",
        });
      }
      router.refresh(); // price and/or wanted list changed
    } catch (e) {
      addToast({ title: "Lookup failed", description: String(e.message), color: "danger" });
    } finally {
      setLookingUp(null);
    }
  };

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
        {trendable > 0 ? (
          <p className="text-default-400 text-xs mt-1">
            {trendable} of {ingredients.length} ingredients have enough history to trend.
          </p>
        ) : (
          <p className="text-default-400 text-xs mt-1">
            No ingredient has two days of history yet — trends fill in as the daily sync runs.
          </p>
        )}
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
        <Tooltip content="Record what you actually paid — outranks every feed">
          <Button variant="flat" onPress={() => openPurchase()} size="sm" className="h-8">
            ₹ Log a purchase
          </Button>
        </Tooltip>
      </div>

      {/* Item 6's wanted list: ingredients no source could price. This is the
          queue the manual packaged-goods scrape works through first. */}
      {wanted.length > 0 && (
        <div className="rounded-medium border border-warning-200 bg-warning-50/50 px-4 py-3">
          <p className="text-sm font-semibold text-warning-700">
            {wanted.length} ingredient{wanted.length === 1 ? "" : "s"} still {wanted.length === 1 ? "needs" : "need"} a
            real price
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {wanted.map((w) => (
              <Tooltip
                key={w._id}
                content={`asked ${w.timesRequested}x · ${w.lastError || "no reason recorded"}`}
              >
                <Chip
                  size="sm"
                  variant="flat"
                  color="warning"
                  className="cursor-pointer"
                  onClick={() => openPurchase(w.ingredientName)}
                >
                  {w.ingredientName}
                </Chip>
              </Tooltip>
            ))}
          </div>
          <p className="text-xs text-default-500 mt-2">
            No feed carries these, so they're unpriced or running on an AI guess. Click one to log
            what you actually paid — that's the only thing that clears it.
          </p>
        </div>
      )}

      <Table aria-label="Price book">
        <TableHeader>
          <TableColumn>INGREDIENT</TableColumn>
          <TableColumn>PRICE</TableColumn>
          <TableColumn>PER</TableColumn>
          <TableColumn>SOURCE</TableColumn>
          <TableColumn>90-DAY TREND</TableColumn>
          <TableColumn>UPDATED</TableColumn>
          <TableColumn align="center">ACTIONS</TableColumn>
        </TableHeader>
        <TableBody items={ingredients} emptyContent="No prices yet — add your staples above, or run the seed script.">
          {(ing) => {
            const edit = edits[ing._id] ?? {};
            const stale = staleness(ing.fetchedAt);
            const isEdited = edits[ing._id] !== undefined;
            const hist = history[ing.ingredientName];
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
                  <Sparkline
                    points={hist?.points}
                    stats={hist?.stats}
                    priceUnit={ing.priceUnit}
                  />
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color={stale.color}>{stale.label}</Chip>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <Button size="sm" variant="flat" color="primary" isDisabled={!isEdited} onPress={() => saveRow(ing)}>
                      Save
                    </Button>
                    {/* only offered where it's needed — a priced row doesn't
                        need a lookup, and the button would just invite calls */}
                    {!ing.price && (
                      <Tooltip content="Try the mandi feed, then an AI estimate">
                        <Button
                          size="sm"
                          variant="flat"
                          color="warning"
                          isLoading={lookingUp === ing._id}
                          isDisabled={lookingUp !== null}
                          onPress={() => lookUp(ing)}
                        >
                          Look up
                        </Button>
                      </Tooltip>
                    )}
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

      <LogPurchaseModal
        isOpen={purchaseModal.isOpen}
        onOpenChange={purchaseModal.onOpenChange}
        ingredients={ingredients}
        presetName={purchasePreset}
      />
    </div>
  );
}
