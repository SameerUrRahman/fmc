"use client";
import {
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
  Textarea,
  Tooltip,
  addToast,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { QUANTITY_UNITS, formatINR } from "@/libs/units";

const STATUS_META = {
  ok: { label: "parsed", color: "success" },
  estimated: { label: "estimated", color: "warning" },
  llm: { label: "AI", color: "secondary" },
  unparsed: { label: "couldn't parse", color: "danger" },
};

const inputClasses = {
  inputWrapper: "bg-content2 data-[hover=true]:bg-content3 group-data-[focus=true]:bg-content3",
};

export default function ImportIngredientsModal({ isOpen, onOpenChange, onImport }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState(null); // null = paste step
  const [llmInfo, setLlmInfo] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds left on a 429

  const reset = () => {
    setItems(null);
    setLlmInfo(null);
    setParsing(false);
    setImporting(false);
    setCooldown(0);
  };

  // tick the rate-limit countdown down to zero
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const parse = async () => {
    setParsing(true);
    try {
      const res = await fetch("/api/recipes/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "parse failed");
      setItems(data.items.map((it) => ({ ...it, key: crypto.randomUUID() })));
      setLlmInfo(data.llm);
      setCooldown(data.llm?.code === "rate_limited" ? Math.ceil(data.llm.retryAfterSec ?? 0) : 0);
    } catch (e) {
      addToast({ title: "Couldn't parse", description: String(e.message), color: "danger" });
    } finally {
      setParsing(false);
    }
  };

  const patchItem = (key, patch) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const removeItem = (key) => setItems((prev) => prev.filter((it) => it.key !== key));

  const importable = (items ?? []).filter((it) => it.ingredientName.trim() !== "");

  const confirm = async (close) => {
    setImporting(true);
    try {
      const lines = [];
      for (const it of importable) {
        let match = it.match;
        if (!match) {
          // create a price-less price-book entry so the user can fill it later
          const res = await fetch("/api/knownIngredients", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ingredientName: it.ingredientName.trim(),
              price: 0,
              priceUnit: "kg",
              source: "import",
            }),
          });
          if (res.ok) {
            const { ingredient } = await res.json();
            match = {
              knownIngredientId: ingredient._id,
              price: ingredient.price,
              priceUnit: ingredient.priceUnit,
            };
          }
        }
        lines.push({
          ingredientName: it.ingredientName.trim(),
          quantity: it.quantity,
          unit: it.unit,
          price: match ? String(match.price) : "",
          priceUnit: match?.priceUnit ?? "kg",
          knownIngredientId: match?.knownIngredientId,
        });
      }
      onImport(lines);
      addToast({ title: `Imported ${lines.length} ingredients`, color: "success" });
      setText("");
      reset();
      close();
    } catch (e) {
      addToast({ title: "Import failed", description: String(e.message), color: "danger" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) reset();
        onOpenChange(open);
      }}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              Import ingredients from text
              <span className="text-sm font-normal text-default-500">
                Paste an ingredient list from anywhere — a blog, a YouTube description, WhatsApp…
              </span>
            </ModalHeader>

            <ModalBody>
              {items === null ? (
                <Textarea
                  aria-label="Recipe text"
                  minRows={10}
                  placeholder={"2 cups maida\n1/2 tsp haldi\n2-3 hari mirch, chopped\nsalt to taste"}
                  value={text}
                  onValueChange={setText}
                  classNames={inputClasses}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {llmInfo?.code === "rate_limited" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm text-warning">
                        AI rescue hit the free-tier rate limit
                        {cooldown > 0 ? ` — try again in ${cooldown}s.` : " — you can try again now."}{" "}
                        Unparsed lines can still be fixed by hand.
                      </p>
                      <Button
                        size="sm"
                        variant="flat"
                        color="warning"
                        isDisabled={cooldown > 0 || parsing}
                        isLoading={parsing}
                        onPress={parse}
                      >
                        Retry AI rescue
                      </Button>
                      <span className="text-xs text-default-400 basis-full">
                        Retrying re-parses the pasted text, so edits below are lost.
                      </span>
                    </div>
                  ) : (
                    llmInfo?.error && (
                      <p className="text-sm text-warning">
                        AI rescue failed ({llmInfo.error}) — unparsed lines need manual fixing.
                      </p>
                    )
                  )}
                  {!llmInfo?.available && items.some((it) => it.status === "unparsed") && (
                    <p className="text-sm text-default-500">
                      Tip: add a free <code>GROQ_API_KEY</code> or <code>GEMINI_API_KEY</code> to
                      .env and messy lines get fixed by AI automatically.
                    </p>
                  )}
                  {items.length === 0 && (
                    <p className="text-sm text-default-500">Nothing recognizable found — go back and check the pasted text.</p>
                  )}
                  {items.map((it) => (
                    <div
                      key={it.key}
                      className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_90px_110px_150px_auto] gap-2 items-center"
                    >
                      <div className="col-span-2 md:col-span-1 flex flex-col gap-1">
                        <Input
                          aria-label="Ingredient name"
                          size="sm"
                          placeholder={it.status === "unparsed" ? "couldn't read this — type a name or remove" : "Ingredient"}
                          value={it.ingredientName}
                          onValueChange={(v) => patchItem(it.key, { ingredientName: v, match: null })}
                          classNames={inputClasses}
                        />
                        <Tooltip content={it.raw} placement="bottom-start">
                          <span className="text-xs text-default-400 truncate">“{it.raw}”</span>
                        </Tooltip>
                      </div>
                      <Input
                        aria-label="Quantity"
                        size="sm"
                        type="number"
                        min="0"
                        value={String(it.quantity)}
                        onValueChange={(v) => patchItem(it.key, { quantity: v })}
                        classNames={inputClasses}
                      />
                      <Select
                        aria-label="Unit"
                        size="sm"
                        selectedKeys={[it.unit]}
                        onSelectionChange={(keys) => {
                          const u = [...keys][0];
                          if (u) patchItem(it.key, { unit: u });
                        }}
                        classNames={{ trigger: "bg-content2 data-[hover=true]:bg-content3" }}
                      >
                        {QUANTITY_UNITS.map((u) => (
                          <SelectItem key={u}>{u}</SelectItem>
                        ))}
                      </Select>
                      <div className="text-sm">
                        {it.match ? (
                          <Tooltip content={`matched “${it.match.matchedName}”`}>
                            <span className="text-default-600">
                              {formatINR(it.match.price)}/{it.match.priceUnit}
                            </span>
                          </Tooltip>
                        ) : it.ingredientName.trim() ? (
                          <Chip size="sm" variant="flat" color="default">new — no price yet</Chip>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 justify-end">
                        <Chip size="sm" variant="flat" color={STATUS_META[it.status]?.color ?? "default"}>
                          {STATUS_META[it.status]?.label ?? it.status}
                        </Chip>
                        <Button size="sm" variant="light" color="danger" onPress={() => removeItem(it.key)}>
                          ✕
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter>
              {items === null ? (
                <>
                  <Button variant="light" onPress={close}>Cancel</Button>
                  <Button color="primary" onPress={parse} isLoading={parsing} isDisabled={!text.trim()}>
                    Parse
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="light" onPress={reset}>← Back</Button>
                  <Button
                    color="primary"
                    onPress={() => confirm(close)}
                    isLoading={importing}
                    isDisabled={importable.length === 0}
                  >
                    Add {importable.length} ingredient{importable.length === 1 ? "" : "s"}
                  </Button>
                </>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
