// Free-tier LLM fallback for ingredient lines the regex parser couldn't
// handle. Provider-agnostic adapter: set LLM_PROVIDER=groq|gemini (defaults
// to whichever key is present). Without a key the feature is simply off —
// the importer still works, unparsed lines just stay flagged for manual fix.
//
//   GROQ_API_KEY    — free at console.groq.com   (default model: llama-3.3-70b-versatile)
//   GEMINI_API_KEY  — free at aistudio.google.com (default model: gemini-2.5-flash)
//   LLM_MODEL       — optional model override for either provider

import { normalizeUnit } from "./ingredientParser.js";

const VALID_UNITS = ["g", "kg", "mL", "L", "tsp", "tbsp", "cup", "piece", "dozen"];

function provider() {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "groq" && process.env.GROQ_API_KEY) return "groq";
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (forced) return null; // forced provider but its key is missing
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export function llmAvailable() {
  return provider() !== null;
}

function buildPrompt(lines) {
  const numbered = lines.map((l, i) => `${i}: ${l}`).join("\n");
  return `You extract ingredients from recipe text (often Indian recipes, sometimes Hinglish).

For each numbered input line, identify the ingredient. Reply with ONLY a JSON object:
{"items":[{"index":<input line number>,"name":"<ingredient name in english if possible>","quantity":<number>,"unit":"<one of: ${VALID_UNITS.join(", ")}>","notes":"<prep notes or original phrasing, may be empty>"}]}

Rules:
- Convert vague amounts to sensible estimates (a pinch ≈ 0.3 g, a handful ≈ 30 g, 1 katori ≈ 150 mL, "to taste" -> quantity 0 unit g).
- Use "piece" for countable items (2 onions -> quantity 2, unit piece).
- If a line contains no ingredient at all (e.g. a cooking instruction), omit it from items.
- quantity must be a plain number. No fractions, no strings.

Input lines:
${numbered}`;
}

async function callGroq(prompt) {
  const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(prompt) {
  const model = process.env.LLM_MODEL || "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Ask the LLM to extract ingredients from raw lines.
 * @param {string[]} lines raw text lines (typically the regex-unparsed ones)
 * @returns {Promise<Map<number, {ingredientName, quantity, unit, notes}>>}
 *          keyed by input line index; lines the LLM skipped are absent
 */
export async function extractIngredientsLLM(lines) {
  const which = provider();
  if (!which) throw new Error("no LLM provider configured");
  const prompt = buildPrompt(lines);
  const rawText = which === "groq" ? await callGroq(prompt) : await callGemini(prompt);

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // some models wrap JSON in ```json fences despite instructions
    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM returned non-JSON output");
    parsed = JSON.parse(m[0]);
  }

  const out = new Map();
  for (const item of parsed?.items ?? []) {
    const index = Number(item?.index);
    const name = String(item?.name ?? "").trim();
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) continue;
    if (!name || !Number.isFinite(quantity) || quantity < 0) continue;
    // trust but verify the unit — coerce through the parser's alias table
    let unit = VALID_UNITS.includes(item?.unit) ? item.unit : null;
    if (!unit) {
      const norm = normalizeUnit(item?.unit);
      unit = norm && norm.factor === 1 ? norm.unit : "piece";
    }
    out.set(index, {
      ingredientName: name,
      quantity: Math.round(quantity * 100) / 100,
      unit,
      notes: String(item?.notes ?? "").trim(),
    });
  }
  return out;
}
