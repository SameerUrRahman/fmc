// Coverage for the parts of libs/llmExtract.js that don't need a network call:
// the per-task model resolution chain and the rate-limit header parsing.
//
// These are the two things item 5 in ROADMAP.md added, and both are the kind of
// code that fails silently — a wrong model just costs quota against the wrong
// bucket, and a mis-parsed retry-after just shows the user a wrong number.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  extractIngredientsLLM,
  modelFor,
  parseRetryAfter,
  retryAfterFromHeaders,
  LlmError,
} from "../libs/llmExtract.js";

const MODEL_ENV = ["LLM_MODEL", "LLM_MODEL_EXTRACT", "LLM_MODEL_ESTIMATE"];

beforeEach(() => {
  for (const k of MODEL_ENV) delete process.env[k];
});

test("modelFor: per-task defaults differ so the rate-limit buckets differ", () => {
  assert.equal(modelFor("extract", "groq"), "llama-3.3-70b-versatile");
  assert.equal(modelFor("estimate", "groq"), "llama-3.1-8b-instant");
  assert.notEqual(modelFor("extract", "groq"), modelFor("estimate", "groq"));
  assert.equal(modelFor("extract", "gemini"), "gemini-2.5-flash");
});

test("modelFor: precedence is argument > per-task env > global env > default", () => {
  process.env.LLM_MODEL = "global-model";
  assert.equal(modelFor("extract", "groq"), "global-model", "global env beats the default");

  process.env.LLM_MODEL_EXTRACT = "extract-model";
  assert.equal(modelFor("extract", "groq"), "extract-model", "per-task env beats global");
  assert.equal(modelFor("estimate", "groq"), "global-model", "and doesn't leak across tasks");

  assert.equal(modelFor("extract", "groq", "explicit"), "explicit", "argument beats everything");
});

test("modelFor: unknown task falls back rather than returning undefined", () => {
  assert.equal(modelFor("nonsense", "groq"), "llama-3.3-70b-versatile");
});

test("parseRetryAfter: bare seconds", () => {
  assert.equal(parseRetryAfter("60"), 60);
  assert.equal(parseRetryAfter("7.66"), 7.66);
  assert.equal(parseRetryAfter(30), 30);
});

test("parseRetryAfter: Go-style durations, which is what Groq actually sends", () => {
  assert.equal(parseRetryAfter("7.66s"), 7.66);
  assert.equal(parseRetryAfter("2m59.56s"), 179.56);
  assert.equal(parseRetryAfter("1h2m3s"), 3723);
  assert.equal(parseRetryAfter("500ms"), 0.5);
});

test("parseRetryAfter: HTTP-date", () => {
  const future = new Date(Date.now() + 120_000).toUTCString();
  const secs = parseRetryAfter(future);
  assert.ok(secs > 110 && secs <= 120, `expected ~120s, got ${secs}`);
  // a date in the past means "now", not a negative wait
  assert.equal(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString()), 0);
});

test("parseRetryAfter: unparseable input is null, never NaN or 0", () => {
  for (const bad of [null, undefined, "", "   ", "soon", "abc"]) {
    assert.equal(parseRetryAfter(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

/** Minimal Headers stand-in — case-insensitive get, like the real thing. */
function headers(obj) {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k) => lower.get(k.toLowerCase()) ?? null };
}

test("retryAfterFromHeaders: retry-after wins when present", () => {
  const h = headers({ "retry-after": "12", "x-ratelimit-reset-tokens": "2m" });
  assert.equal(retryAfterFromHeaders(h), 12);
});

test("retryAfterFromHeaders: without retry-after, take the longest reset window", () => {
  // The headers don't say which bucket was exhausted. Waiting too long costs
  // one slow import; waiting too little costs a second 429.
  const h = headers({
    "x-ratelimit-reset-requests": "7.66s",
    "x-ratelimit-reset-tokens": "2m59.56s",
  });
  assert.equal(retryAfterFromHeaders(h), 180, "180 = ceil(179.56)");
});

test("retryAfterFromHeaders: rounds up, so a 0.4s wait never displays as 0s", () => {
  assert.equal(retryAfterFromHeaders(headers({ "retry-after": "0.4s" })), 1);
});

test("retryAfterFromHeaders: no usable headers is null, not a guess", () => {
  assert.equal(retryAfterFromHeaders(headers({})), null);
  assert.equal(retryAfterFromHeaders(headers({ "retry-after": "whenever" })), null);
  assert.equal(retryAfterFromHeaders(null), null);
});

/**
 * Run `fn` with the provider env forced to groq and fetch stubbed to `response`.
 * Restores everything afterwards, including a rejected promise.
 */
async function withStubbedGroq(response, fn) {
  const saved = {
    fetch: globalThis.fetch,
    key: process.env.GROQ_API_KEY,
    provider: process.env.LLM_PROVIDER,
  };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return response;
  };
  process.env.GROQ_API_KEY = "test-key";
  process.env.LLM_PROVIDER = "groq";
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = saved.key;
    if (saved.provider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = saved.provider;
  }
}

test("a 429 surfaces as a rate_limited LlmError with the wait, not an opaque string", async () => {
  const res = new Response("rate limit reached for llama-3.3-70b-versatile", {
    status: 429,
    headers: { "retry-after": "8" },
  });
  await withStubbedGroq(res, async () => {
    const err = await extractIngredientsLLM(["2 pyaz"]).then(
      () => null,
      (e) => e
    );
    assert.ok(err instanceof LlmError, "expected an LlmError");
    assert.equal(err.code, "rate_limited");
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterSec, 8);
    assert.match(err.message, /try again in 8s/);
  });
});

test("a 429 with no retry-after still classifies, reading the wait out of the body", async () => {
  const res = new Response(
    JSON.stringify({ error: { message: "Rate limit reached. Please try again in 7.66s." } }),
    { status: 429 }
  );
  await withStubbedGroq(res, async () => {
    const err = await extractIngredientsLLM(["2 pyaz"]).catch((e) => e);
    assert.equal(err.code, "rate_limited");
    assert.equal(err.retryAfterSec, 8, "ceil(7.66)");
  });
});

test("a bad key is auth, not rate_limited — the UI must not offer a retry timer", async () => {
  await withStubbedGroq(new Response("invalid api key", { status: 401 }), async () => {
    const err = await extractIngredientsLLM(["2 pyaz"]).catch((e) => e);
    assert.equal(err.code, "auth");
    assert.equal(err.retryAfterSec, null);
  });
});

test("a 500 is server, and the model that failed is on the error", async () => {
  await withStubbedGroq(new Response("upstream boom", { status: 503 }), async () => {
    const err = await extractIngredientsLLM(["2 pyaz"]).catch((e) => e);
    assert.equal(err.code, "server");
    assert.equal(err.model, "llama-3.3-70b-versatile");
    assert.equal(err.provider, "groq");
  });
});

test("the per-call model override reaches the request body", async () => {
  const ok = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }), {
      status: 200,
    });
  await withStubbedGroq(ok(), async (calls) => {
    await extractIngredientsLLM(["2 pyaz"], { model: "llama-3.1-8b-instant" });
    assert.equal(calls[0].body.model, "llama-3.1-8b-instant");
  });
});

test("LlmError carries the classification through JSON serialization", () => {
  const e = new LlmError("rate limited — try again in 8s", {
    code: "rate_limited",
    status: 429,
    retryAfterSec: 8,
    provider: "groq",
    model: "llama-3.3-70b-versatile",
  });
  assert.ok(e instanceof Error);
  const wire = JSON.parse(JSON.stringify(e));
  assert.equal(wire.code, "rate_limited");
  assert.equal(wire.retryAfterSec, 8);
  assert.equal(wire.status, 429);
});
