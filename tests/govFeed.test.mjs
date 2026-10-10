// Retry and staleness rules for the daily data.gov.in sync.
//
// The feed went from 504s to refused connections in late Sep 2026 and the cron
// went red every day. These pin down which failures are retried and excused as
// an outage (network errors, 5xx, 429) and which fail straight away (4xx —
// e.g. a revoked API key would otherwise hide behind "the feed is down").

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchWithRetry,
  FeedUnreachableError,
  isRetryableStatus,
  daysSince,
} from "../libs/govFeed.js";

const ok = () => new Response(JSON.stringify({ records: [] }), { status: 200 });
const status = (code) => new Response("<html>nginx</html>", { status: code });
const refused = () => {
  const err = new TypeError("fetch failed");
  err.cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  return err;
};

// Replays a script of responses/errors, one per call.
function scripted(steps) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const step = steps[calls.length - 1];
    if (step instanceof Error) throw step;
    return step();
  };
  return { fetchImpl, calls };
}

const noSleep = { sleep: async () => {} };

test("first OK response is returned without retrying", async () => {
  const { fetchImpl, calls } = scripted([ok]);
  const res = await fetchWithRetry("https://x", { fetchImpl, ...noSleep });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test("a 504 then a refused connection then OK recovers", async () => {
  const { fetchImpl, calls } = scripted([() => status(504), refused(), ok]);
  const res = await fetchWithRetry("https://x", { fetchImpl, ...noSleep });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
});

test("persistent refusal becomes FeedUnreachableError naming the cause", async () => {
  const { fetchImpl, calls } = scripted([refused(), refused(), refused()]);
  await assert.rejects(
    fetchWithRetry("https://x", { fetchImpl, ...noSleep }),
    (e) => e instanceof FeedUnreachableError && /ECONNREFUSED/.test(e.message)
  );
  assert.equal(calls.length, 3);
});

test("a timeout is retried like a network error", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const { fetchImpl } = scripted([timeout, timeout, timeout]);
  await assert.rejects(fetchWithRetry("https://x", { fetchImpl, ...noSleep }), FeedUnreachableError);
});

test("a 403 fails immediately and is NOT treated as an outage", async () => {
  const { fetchImpl, calls } = scripted([() => status(403)]);
  await assert.rejects(
    fetchWithRetry("https://x", { fetchImpl, ...noSleep }),
    (e) => !(e instanceof FeedUnreachableError) && /403/.test(e.message)
  );
  assert.equal(calls.length, 1);
});

test("backoff doubles between attempts", async () => {
  const delays = [];
  const { fetchImpl } = scripted([refused(), refused(), refused()]);
  await assert.rejects(
    fetchWithRetry("https://x", { fetchImpl, baseDelayMs: 2000, sleep: async (ms) => delays.push(ms) })
  );
  assert.deepEqual(delays, [2000, 4000]); // no sleep after the last attempt
});

test("retryable statuses are 5xx and 429 only", () => {
  for (const s of [429, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, String(s));
  for (const s of [400, 401, 403, 404]) assert.equal(isRetryableStatus(s), false, String(s));
});

test("daysSince counts whole days, Infinity when never synced", () => {
  const now = new Date("2026-10-10T03:30:00Z");
  assert.equal(daysSince(new Date("2026-10-09T03:30:00Z"), now), 1);
  assert.equal(daysSince(new Date("2026-10-03T04:00:00Z"), now), 6); // 6.98 days
  assert.equal(daysSince(new Date("2026-09-25T03:30:00Z"), now), 15);
  assert.equal(daysSince(null, now), Infinity);
  assert.equal(daysSince(undefined, now), Infinity);
});
