"use client";
import {
  Autocomplete,
  AutocompleteItem,
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  addToast,
} from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PRICE_UNITS, formatINR } from "@/libs/units";
import { derivePurchase, comparePurchase } from "@/libs/purchases";
import { istDay } from "@/libs/istDay";

const inputClasses = {
  inputWrapper: "bg-content2 data-[hover=true]:bg-content3 group-data-[focus=true]:bg-content3",
};

export default function LogPurchaseModal({ isOpen, onOpenChange, ingredients = [], presetName = "" }) {
  const router = useRouter();
  const today = istDay();

  const [ingredientName, setIngredientName] = useState(presetName);
  const [totalPaid, setTotalPaid] = useState("");
  const [quantity, setQuantity] = useState("");
  const [priceUnit, setPriceUnit] = useState("kg");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // reopening for a different row shouldn't keep the last one's name
  useEffect(() => {
    if (isOpen) setIngredientName(presetName);
  }, [isOpen, presetName]);

  const reset = () => {
    setTotalPaid("");
    setQuantity("");
    setPriceUnit("kg");
    setDay(today);
    setNote("");
  };

  // Same function the server validates with, run live for the preview. The
  // route re-runs it — this is for feedback, not for trust.
  const derived = useMemo(
    () => derivePurchase({ ingredientName, totalPaid, quantity, priceUnit, day, note }),
    [ingredientName, totalPaid, quantity, priceUnit, day, note]
  );

  // What the price book currently believes, for the feed-validation comparison.
  const book = useMemo(
    () =>
      ingredients.find(
        (i) => i.ingredientName.toLowerCase() === ingredientName.trim().toLowerCase()
      ) ?? null,
    [ingredients, ingredientName]
  );

  // Only comparable in the same unit — "₹55/kg vs ₹0.06/g" is a real comparison
  // but a confusing one to show, so it's skipped rather than converted here.
  const comparison =
    derived.ok && book && book.priceUnit === priceUnit && book.price > 0
      ? comparePurchase(derived.value.price, book.price)
      : null;

  const submit = async (close) => {
    if (!derived.ok) {
      addToast({ title: derived.error, color: "warning" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ingredientName, totalPaid, quantity, priceUnit, day, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "couldn't save");
      addToast({
        title: `Logged ${formatINR(derived.value.price)}/${priceUnit} for ${ingredientName}`,
        description: data.updatedBook
          ? "Price book updated — purchases outrank every feed."
          : "Backdated, so it went to history only; the current price is unchanged.",
        color: "success",
      });
      reset();
      close();
      router.refresh();
    } catch (e) {
      addToast({ title: "Couldn't log it", description: String(e.message), color: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) reset();
        onOpenChange(open);
      }}
      size="xl"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              Log what you paid
              <span className="text-sm font-normal text-default-500">
                The only price here that isn't a market proxy. Enter it as the receipt reads —
                the ₹ per unit is worked out below.
              </span>
            </ModalHeader>

            <ModalBody className="gap-4">
              <Autocomplete
                label="Ingredient"
                labelPlacement="outside"
                placeholder="Start typing…"
                allowsCustomValue
                size="sm"
                inputValue={ingredientName}
                onInputChange={setIngredientName}
                onSelectionChange={(sel) => sel != null && setIngredientName(String(sel))}
                defaultItems={ingredients}
                inputProps={{ classNames: inputClasses }}
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

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                <Input
                  label="Paid"
                  labelPlacement="outside"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="110"
                  size="sm"
                  startContent={<span className="text-default-400 text-sm">₹</span>}
                  value={totalPaid}
                  onValueChange={setTotalPaid}
                  classNames={inputClasses}
                />
                <Input
                  label="For"
                  labelPlacement="outside"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="2"
                  size="sm"
                  value={quantity}
                  onValueChange={setQuantity}
                  classNames={inputClasses}
                />
                <Select
                  label="Unit"
                  labelPlacement="outside"
                  size="sm"
                  selectedKeys={[priceUnit]}
                  onSelectionChange={(keys) => setPriceUnit([...keys][0] ?? "kg")}
                  aria-label="Purchase unit"
                >
                  {PRICE_UNITS.map((u) => (
                    <SelectItem key={u}>{u}</SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="When"
                  labelPlacement="outside"
                  type="date"
                  max={today}
                  size="sm"
                  value={day}
                  onValueChange={setDay}
                  classNames={inputClasses}
                />
                <Input
                  label="Where / note"
                  labelPlacement="outside"
                  placeholder="Ratnadeep, 1 kg pack"
                  size="sm"
                  value={note}
                  onValueChange={setNote}
                  classNames={inputClasses}
                />
              </div>

              {/* the derived unit price, and how it compares to the feeds */}
              <div className="rounded-medium bg-content2 px-4 py-3 flex flex-col gap-2">
                {derived.ok ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-default-500">Works out to</span>
                      <span className="text-lg font-bold text-primary">
                        {formatINR(derived.value.price)}/{priceUnit}
                      </span>
                    </div>
                    {book && book.price > 0 && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-default-500">
                          Price book says ({book.source || "manual"})
                        </span>
                        <span className="text-sm tabular-nums">
                          ₹{book.price}/{book.priceUnit}
                        </span>
                      </div>
                    )}
                    {comparison && comparison.direction !== "same" && (
                      <p className="text-xs text-default-500">
                        You paid{" "}
                        <span
                          className={
                            comparison.direction === "higher" ? "text-warning" : "text-success"
                          }
                        >
                          {Math.abs(comparison.deltaPct).toFixed(0)}% {comparison.direction}
                        </span>{" "}
                        than the price book. That gap is a finding about the feed, not a
                        mistake — it's the wholesale-to-retail spread showing up.
                      </p>
                    )}
                    {!derived.value.isCurrent && (
                      <Chip size="sm" variant="flat" color="warning">
                        backdated — history only, current price untouched
                      </Chip>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-default-400">{derived.error}</span>
                )}
              </div>
            </ModalBody>

            <ModalFooter>
              <Button variant="light" onPress={close}>
                Cancel
              </Button>
              <Button
                color="primary"
                onPress={() => submit(close)}
                isLoading={saving}
                isDisabled={!derived.ok}
              >
                Log purchase
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
