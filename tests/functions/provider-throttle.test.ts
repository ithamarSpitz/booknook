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
