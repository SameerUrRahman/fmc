// Resilience helpers for the daily data.gov.in sync (scripts/fetch_gov_prices.mjs).
//
// The feed is a government endpoint with no SLA: it has gone through days of
// 502/504s and stretches of refusing connections outright. The cron should
// ride out a bad morning without going red, but must still go red once the
// price book has been running on old numbers for too long — otherwise an
// outage is silent forever.
//
// Pure apart from the injected fetch/sleep. Tested in tests/govFeed.test.mjs.

/** Thrown when the feed couldn't be reached at all after every retry. */
export class FeedUnreachableError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "FeedUnreachableError";
  }
}

// 5xx and 429 are the server's problem and worth another try. Other 4xx (a bad
// or revoked API key, a malformed filter) will fail the same way every time, so
// they surface immediately as a hard error instead of being retried and then
// excused as an outage.
export function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() with a per-attempt timeout and exponential backoff.
 *
 * Resolves with the first OK response. Throws FeedUnreachableError if every
 * attempt hit a network error, timeout or retryable status; throws a plain
 * Error straight away on a non-retryable status.
 */
export async function fetchWithRetry(
  url,
  { attempts = 3, timeoutMs = 20_000, baseDelayMs = 2_000, fetchImpl = fetch, sleep = realSleep, log = () => {} } = {}
) {
  let lastProblem;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      if (!isRetryableStatus(res.status)) {
        throw new Error(`data.gov.in responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      lastProblem = `HTTP ${res.status}`;
    } catch (e) {
      if (!(e instanceof TypeError) && e?.name !== "TimeoutError" && e?.name !== "AbortError") throw e;
      // fetch() rejects with TypeError("fetch failed") for refused connections
      // and DNS failures; the useful detail is on .cause.
      lastProblem = e.cause?.code ?? e.cause?.message ?? e.message;
    }
    if (attempt < attempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      log(`data.gov.in attempt ${attempt}/${attempts} failed (${lastProblem}); retrying in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
  throw new FeedUnreachableError(`data.gov.in unreachable after ${attempts} attempts (last: ${lastProblem})`);
}

/**
 * Whole days since the feed last wrote a price, or Infinity if it never has.
 * @param {Date|null|undefined} lastObservedAt
 */
export function daysSince(lastObservedAt, now = new Date()) {
  if (!lastObservedAt) return Infinity;
  return Math.floor((now.getTime() - new Date(lastObservedAt).getTime()) / 86_400_000);
}
