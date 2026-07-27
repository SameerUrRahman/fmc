// Free-tier LLM fallback for ingredient lines the regex parser couldn't
// handle. Provider-agnostic adapter: set LLM_PROVIDER=groq|gemini (defaults
// to whichever key is present). Without a key the feature is simply off —
// the importer still works, unparsed lines just stay flagged for manual fix.
//
//   GROQ_API_KEY    — free at console.groq.com
//   GEMINI_API_KEY  — free at aistudio.google.com
//
// Model selection is per *task*, not global. Groq's rate-limit buckets are
// per model with independent counters, so running the cheap task on a
// different model buys real headroom instead of competing with imports:
//
//   LLM_MODEL           — override every task (blunt instrument, kept for compat)
//   LLM_MODEL_EXTRACT   — the ingredient extractor (needs to follow a schema)
//   LLM_MODEL_ESTIMATE  — ballpark price estimates (small/fast is fine)
//
// Failures come back as LlmError with a `code`, so a 429 is distinguishable
// from a dead key or a garbled response. Callers can render
// "rate limited, try again in Ns" instead of an opaque string.

import { normalizeUnit } from "./ingredientParser.js";

const VALID_UNITS = ["g", "kg", "mL", "L", "tsp", "tbsp", "cup", "piece", "dozen"];

// task -> per-provider default. Extraction has to emit a schema, so it gets
// the bigger model; an estimate is a ballpark and doesn't.
const MODEL_DEFAULTS = {
  extract: { groq: "llama-3.3-70b-versatile", gemini: "gemini-2.5-flash" },
  estimate: { groq: "llama-3.1-8b-instant", gemini: "gemini-2.5-flash-lite" },
};

/**
 * An LLM call that failed, classified.
 * @property {string} code   rate_limited | auth | server | request | bad_response | no_provider
 * @property {number|null} status        HTTP status, when there was one
 * @property {number|null} retryAfterSec seconds to wait, when the provider said
 */
export class LlmError extends Error {
  constructor(message, { code = "request", status = null, retryAfterSec = null, provider = null, model = null } = {}) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.provider = provider;
    this.model = model;
  }

  /** Shape safe to hand to the client. */
  toJSON() {
    return {
      message: this.message,
      code: this.code,
      status: this.status,
      retryAfterSec: this.retryAfterSec,
      provider: this.provider,
      model: this.model,
    };
  }
}

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

/**
 * Which model runs a given task, most specific wins:
 * explicit argument > LLM_MODEL_<TASK> > LLM_MODEL > per-task default.
 * @param {"extract"|"estimate"} task
 * @param {string} which provider name
 * @param {string} [override] caller-supplied model
 */
export function modelFor(task, which, override) {
  if (override) return override;
  const perTask = process.env[`LLM_MODEL_${String(task).toUpperCase()}`];
  if (perTask) return perTask;
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  return MODEL_DEFAULTS[task]?.[which] ?? MODEL_DEFAULTS.extract[which];
}

/**
 * Parse a provider's "wait this long" value into seconds.
 * Handles bare seconds ("60", "7.66"), Go-style durations ("2m59.56s",
 * "1h2m3s", "500ms"), and HTTP-dates. Returns null if it can't tell.
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function parseRetryAfter(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);

  const duration = raw.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/i);
  if (duration && duration.slice(1).some((g) => g !== undefined)) {
    const [h, m, s, ms] = duration.slice(1).map((g) => (g === undefined ? 0 : Number(g)));
    return h * 3600 + m * 60 + s + ms / 1000;
  }

  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, (at - Date.now()) / 1000);

  return null;
}

/**
 * How long to wait after a 429, from whichever headers the provider set.
 *
 * `retry-after` is authoritative when present. Otherwise we take the *longest*
 * of the reset windows: the headers don't say which bucket was exhausted, and
 * waiting too long costs one slow import while waiting too little costs a
 * second 429.
 * @param {Headers|{get:(k:string)=>string|null}} headers
 * @returns {number|null} seconds, rounded up
 */
export function retryAfterFromHeaders(headers) {
  const get = (k) => (headers && typeof headers.get === "function" ? headers.get(k) : null);

  const explicit = parseRetryAfter(get("retry-after"));
  if (explicit !== null) return Math.ceil(explicit);

  const resets = ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]
    .map((h) => parseRetryAfter(get(h)))
    .filter((v) => v !== null);
  if (resets.length === 0) return null;
  return Math.ceil(Math.max(...resets));
}

/** Map an HTTP status onto an LlmError code. */
function codeForStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "request";
}

/** Build the LlmError for a non-2xx provider response. */
async function errorFromResponse(res, { provider: which, model }) {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  const code = codeForStatus(res.status);

  let retryAfterSec = retryAfterFromHeaders(res.headers);
  if (code === "rate_limited" && retryAfterSec === null) {
    // Groq repeats the wait in prose when the headers are absent:
    // "Please try again in 7.66s." — the duration must not eat the full stop,
    // so match unit-suffixed groups explicitly rather than a loose char class.
    const inBody = body.match(/try again in ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+|\d+(?:\.\d+)?)/i);
    const parsed = parseRetryAfter(inBody?.[1]);
    if (parsed !== null) retryAfterSec = Math.ceil(parsed);
  }

  const message =
    code === "rate_limited"
      ? retryAfterSec !== null
        ? `rate limited — try again in ${retryAfterSec}s`
        : "rate limited — try again shortly"
      : code === "auth"
        ? `${which} rejected the API key (${res.status})`
        : `${which} ${res.status}: ${body}`;

  return new LlmError(message, { code, status: res.status, retryAfterSec, provider: which, model });
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

async function callGroq(prompt, model) {
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
  } catch (e) {
    throw new LlmError(`couldn't reach groq: ${e.message}`, { code: "network", provider: "groq", model });
  }
  if (!res.ok) throw await errorFromResponse(res, { provider: "groq", model });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(prompt, model) {
  let res;
  try {
    res = await fetch(
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
  } catch (e) {
    throw new LlmError(`couldn't reach gemini: ${e.message}`, { code: "network", provider: "gemini", model });
  }
  if (!res.ok) throw await errorFromResponse(res, { provider: "gemini", model });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Ask the LLM to extract ingredients from raw lines.
 * @param {string[]} lines raw text lines (typically the regex-unparsed ones)
 * @param {{model?: string, task?: "extract"|"estimate"}} [options]
 *        per-call model override; falls back to the env chain in modelFor()
 * @returns {Promise<Map<number, {ingredientName, quantity, unit, notes}>>}
 *          keyed by input line index; lines the LLM skipped are absent
 * @throws {LlmError}
 */
export async function extractIngredientsLLM(lines, options = {}) {
  const which = provider();
  if (!which) throw new LlmError("no LLM provider configured", { code: "no_provider" });
  const task = options.task ?? "extract";
  const model = modelFor(task, which, options.model);
  const prompt = buildPrompt(lines);
  const rawText =
    which === "groq" ? await callGroq(prompt, model) : await callGemini(prompt, model);

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // some models wrap JSON in ```json fences despite instructions
    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new LlmError("LLM returned non-JSON output", {
        code: "bad_response",
        provider: which,
        model,
      });
    }
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
