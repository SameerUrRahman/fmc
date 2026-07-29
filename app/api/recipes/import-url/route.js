import dns from "node:dns/promises";
import { NextResponse } from "next/server";
import {
  normalizeRecipeUrl,
  isBlockedAddress,
  extractRecipeFromHtml,
  pickLlmCandidates,
  cleanIngredientLines,
} from "@/libs/recipeUrl";
import { llmAvailable, extractIngredientsLLM } from "@/libs/llmExtract";

// POST { url } -> { title, servings, ingredients: string[], via, llm }
//
// Item 9. Fetch a recipe page and pull its ingredient list out. Most recipe
// sites emit schema.org/Recipe as JSON-LD, so the common case is one fetch and
// a JSON parse; libs/recipeUrl.js holds the full ladder and all the parsing.
//
// It returns raw *text lines*, not costed ingredients. The client feeds them to
// /api/recipes/parse, the same endpoint pasted text goes through, so units,
// Hinglish aliases, LLM rescue and price-book matching all behave identically
// no matter how the text arrived. A URL is an input channel, not a parser.
//
// This route is an unauthenticated outbound fetch primitive, so it is fenced:
// public addresses only (checked again after DNS and on every redirect hop),
// HTML only, 1.5 MB and 10 s caps.

export const runtime = "nodejs"; // needs node:dns; not available on edge

const MAX_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;

/**
 * Resolve a hostname and reject if *any* answer is a private address.
 *
 * Hostname-shape checks aren't enough on their own: `evil.example.com` is a
 * perfectly public name that can resolve to 127.0.0.1, which is the whole
 * trick behind DNS-rebinding SSRF. There is still a TOCTOU gap between this
 * lookup and fetch()'s own — closing it needs a pinned-IP agent, which is more
 * machinery than a demo importer warrants. The check that matters most is the
 * one at the top: this endpoint returns page *text*, never a raw response body.
 */
async function assertPublicHost(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ImportError(`couldn't resolve ${hostname}`, 400);
  }
  if (addresses.length === 0) throw new ImportError(`couldn't resolve ${hostname}`, 400);
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new ImportError("that address is on a private network", 400);
  }
}

class ImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Read a response body up to MAX_BYTES, then stop pulling. */
async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        chunks.push(value.slice(0, value.byteLength - (total - MAX_BYTES)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map((c) => Buffer.from(c)))
  );
}

/**
 * Fetch a page, following redirects by hand so every hop is re-validated —
 * `redirect: "follow"` would happily land on a 302 to 169.254.169.254 with no
 * way to see it happened.
 */
async function fetchPage(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);

    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          // Some recipe sites 403 an obviously scripted client. Identify as a
          // browser but say what this is; the alternative is a blank page.
          "user-agent":
            "Mozilla/5.0 (compatible; FMC recipe importer; +https://fmc-livid.vercel.app)",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-IN,en;q=0.9",
        },
      });
    } catch (e) {
      const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
      throw new ImportError(
        timedOut ? "that site took too long to respond" : `couldn't reach ${url.hostname}`,
        504
      );
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      let next;
      try {
        next = new URL(res.headers.get("location"), url);
      } catch {
        throw new ImportError("that site sent a broken redirect", 502);
      }
      const checked = normalizeRecipeUrl(next.href);
      if (!checked.ok) throw new ImportError(`redirect blocked: ${checked.error}`, 400);
      url = checked.url;
      continue;
    }

    if (!res.ok) {
      throw new ImportError(
        res.status === 403 || res.status === 401
          ? "that site refused the request — paste the ingredient list instead"
          : `that page returned ${res.status}`,
        502
      );
    }

    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw new ImportError(`that URL isn't a web page (${type.split(";")[0] || "unknown type"})`, 415);
    }

    return { html: await readCapped(res), finalUrl: url };
  }
  throw new ImportError("that URL redirects too many times", 502);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const checked = normalizeRecipeUrl(body?.url);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const llm = { available: llmAvailable(), used: false, error: null, code: null, retryAfterSec: null };

  let page;
  try {
    page = await fetchPage(checked.url);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof ImportError ? e.message : "couldn't fetch that page" },
      { status: e?.status ?? 502 }
    );
  }

  const found = extractRecipeFromHtml(page.html);
  let { title, ingredients, servings, via } = found;

  // Nothing structural. Ask the LLM which of the quantity-bearing lines are
  // ingredients — selection only; the lines it picks still go through the
  // regex parser afterwards like any pasted text.
  if (ingredients.length === 0 && llm.available) {
    const candidates = pickLlmCandidates(page.html);
    if (candidates.length > 0) {
      try {
        const picked = await extractIngredientsLLM(candidates);
        ingredients = cleanIngredientLines([...picked.keys()].sort((a, b) => a - b).map((i) => candidates[i]));
        if (ingredients.length > 0) via = "llm";
        llm.used = true;
      } catch (e) {
        llm.error = String(e.message || e);
        llm.code = e?.code ?? "unknown";
        llm.retryAfterSec = e?.retryAfterSec ?? null;
      }
    }
  }

  if (ingredients.length === 0) {
    return NextResponse.json(
      {
        error:
          "no ingredient list found on that page — copy the ingredients and use “Paste text” instead",
        title,
        via,
        llm,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    title,
    servings,
    ingredients,
    via,
    sourceUrl: page.finalUrl.href,
    llm,
  });
}
