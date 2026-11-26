import { assertEquals } from "jsr:@std/assert@1";
import { throttledHardcoverFetch } from "../../scripts/lib/provider-throttle.ts";

const HC = "https://api.hardcover.app/v1/graphql";

function clock() {
  let t = 10_000;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      sleepLog.push(ms);
      return Promise.resolve();
    },
  };
}
let sleepLog: number[] = [];

Deno.test("hardcover calls are at least 1000 ms apart", async () => {
  sleepLog = [];
  const c = clock();
  const starts: number[] = [];
  const f = throttledHardcoverFetch(
    (() => {
      starts.push(c.now());
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch,
    c.sleep,
    c.now,
  );
  await Promise.all([f(HC), f(HC)]);
  assertEquals(starts[1] - starts[0] >= 1000, true);
});

Deno.test("429 waits Retry-After seconds and retries", async () => {
  sleepLog = [];
  const c = clock();
  let calls = 0;
  const f = throttledHardcoverFetch(
    (() => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
          : new Response("ok"),
      );
    }) as typeof fetch,
    c.sleep,
    c.now,
  );
  const res = await f(HC);
  assertEquals(res.status, 200);
  assertEquals(calls, 2);
  assertEquals(sleepLog.includes(2000), true);
});

Deno.test("six 429s return the last 429 after 5 retries", async () => {
  sleepLog = [];
  const c = clock();
  let calls = 0;
  const f = throttledHardcoverFetch(
    (() => {
      calls++;
      return Promise.resolve(new Response("", { status: 429 }));
    }) as typeof fetch,
    c.sleep,
    c.now,
  );
  const res = await f(HC);
  assertEquals(res.status, 429);
  assertEquals(calls, 6);
  assertEquals(sleepLog.filter((ms) => ms === 15000).length, 5);
});

Deno.test("other URLs are not delayed", async () => {
  sleepLog = [];
  const c = clock();
  const f = throttledHardcoverFetch(
    (() => Promise.resolve(new Response("ok"))) as typeof fetch,
    c.sleep,
    c.now,
  );
  await f("https://example.com/a");
  await f("https://example.com/b");
  assertEquals(sleepLog.length, 0);
});

import { FakeTime } from "jsr:@std/testing@1/time";
import { pendingHosts } from "../../scripts/lib/provider-throttle.ts";

Deno.test("Retry-After above 60 s returns the 429 without sleeping", async () => {
  sleepLog = [];
  const c = clock();
  let calls = 0;
  const f = throttledHardcoverFetch(
    (() => {
      calls++;
      return Promise.resolve(
        new Response("", { status: 429, headers: { "Retry-After": "3600" } }),
      );
    }) as typeof fetch,
    c.sleep,
    c.now,
  );
  const res = await f(HC);
  assertEquals(res.status, 429);
  assertEquals(calls, 1);
  // Only spacing waits (< 15 s, the no-header default) may have happened.
  assertEquals(sleepLog.every((ms) => ms < 15_000), true);
});

Deno.test("Retry-After 30 sleeps 30 s and retries", async () => {
  sleepLog = [];
  const c = clock();
  let calls = 0;
  const f = throttledHardcoverFetch(
    (() => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? new Response("", { status: 429, headers: { "Retry-After": "30" } })
          : new Response("ok"),
      );
    }) as typeof fetch,
    c.sleep,
    c.now,
  );
  assertEquals((await f(HC)).status, 200);
  assertEquals(sleepLog.includes(30_000), true);
});

Deno.test("pendingHosts lists a group while in flight", async () => {
  const c = clock();
  let finish!: () => void;
  const f = throttledHardcoverFetch(
    (() =>
      new Promise<Response>((r) => (finish = () => r(new Response("ok"))))) as typeof fetch,
    c.sleep,
    c.now,
  );
  const p = f(HC);
  assertEquals(pendingHosts(), ["hardcover"]);
  await new Promise((r) => setTimeout(r, 0));
  finish();
  await p;
  await Promise.resolve();
  assertEquals(pendingHosts(), []);
});

Deno.test("queued request times out after 5 minutes; queue keeps moving", async () => {
  using time = new FakeTime();
  let calls = 0;
  const f = throttledHardcoverFetch(
    (() => {
      calls++;
      return calls === 1 ? new Promise<Response>(() => {}) : Promise.resolve(new Response("ok"));
    }) as typeof fetch,
  );
  f(HC);
  const second = f(HC).then(() => "ok", (e: Error) => e.message);
  await time.tickAsync(5 * 60 * 1000 + 1);
  assertEquals(await second, "host queue timeout");
  assertEquals(calls, 1);
  const third = f(HC);
  await time.tickAsync(2000);
  assertEquals((await third).status, 200);
  assertEquals(calls, 2);
});
