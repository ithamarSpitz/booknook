import { assertEquals } from "jsr:@std/assert@1";
import {
  cachedFetch,
  type CacheFs,
  type CacheStats,
} from "../../scripts/lib/provider-cache.ts";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";

const WD = "https://www.wikidata.org/w/api.php?x=1";

function memoryFs() {
  const files = new Map<string, string>();
  const fs: CacheFs = {
    readTextFile: (p) =>
      files.has(p)
        ? Promise.resolve(files.get(p)!)
        : Promise.reject(new Error("ENOENT")),
    writeTextFile: (p, t) => {
      files.set(p, t);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    rename: (a, b) => {
      files.set(b, files.get(a)!);
      files.delete(a);
      return Promise.resolve();
    },
  };
  return { files, fs };
}

async function setup(
  respond: () => Response = () =>
    new Response("שלום", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
) {
  const dir = "/cache";
  const mem = memoryFs();
  const clock = { t: 1000 };
  const stats: CacheStats = { hits: 0, misses: 0, stored: 0 };
  let calls = 0;
  const base = ((_i: unknown, _n?: unknown) => {
    calls++;
    const r = respond();
    if (r.status === 0) return Promise.reject(new Error("boom"));
    return Promise.resolve(r);
  }) as unknown as typeof fetch;
  const f = cachedFetch(base, {
    dir,
    fs: mem.fs,
    ttlMs: 100,
    now: () => clock.t,
    stats,
  });
  return { dir, mem, clock, stats, f, calls: () => calls };
}

Deno.test("second identical GET is served from disk; response rebuilt", async () => {
  const s = await setup();
  const a = await s.f(WD);
  const b = await s.f(WD);
  assertEquals(s.calls(), 1);
  assertEquals(b.status, a.status);
  assertEquals(b.headers.get("content-type"), "text/plain; charset=utf-8");
  assertEquals(await b.text(), await a.text());
  assertEquals(s.stats, { hits: 1, misses: 1, stored: 1 });
});

Deno.test("JSON-RPC id does not affect the key", async () => {
  const s = await setup();
  const body = (id: number, name: string) =>
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name },
    });
  const url = "https://simania.co.il/mcp";
  await s.f(url, { method: "POST", body: body(1, "books_search") });
  await s.f(url, { method: "POST", body: body(7, "books_search") });
  assertEquals(s.calls(), 1);
  await s.f(url, { method: "POST", body: body(8, "book_details") });
  assertEquals(s.calls(), 2);
});

Deno.test("different bodies are different keys", async () => {
  const s = await setup();
  await s.f(WD, { method: "POST", body: "a" });
  await s.f(WD, { method: "POST", body: "b" });
  await s.f(WD, { method: "POST", body: "a" });
  assertEquals(s.calls(), 2);
});

Deno.test("expired entry refetches", async () => {
  const s = await setup();
  await s.f(WD);
  s.clock.t += 101;
  await s.f(WD);
  assertEquals(s.calls(), 2);
});

Deno.test("500 and thrown fetch are not stored", async () => {
  const s = await setup(() => new Response("x", { status: 500 }));
  await s.f(WD);
  await s.f(WD);
  assertEquals(s.calls(), 2);
  assertEquals(s.stats.stored, 0);
  const t = await setup(() => ({ status: 0 }) as Response);
  let threw = 0;
  for (let i = 0; i < 2; i++) {
    try {
      await t.f(WD);
    } catch {
      threw++;
    }
  }
  assertEquals(threw, 2);
  assertEquals(t.stats.stored, 0);
});

Deno.test("wiktionary 404 is stored, wikidata 404 is not", async () => {
  const s = await setup(() => new Response("nope", { status: 404 }));
  const w = "https://en.wiktionary.org/w/api.php?q=1";
  await s.f(w);
  const hit = await s.f(w);
  assertEquals(s.calls(), 1);
  assertEquals(hit.status, 404);
  await s.f(WD);
  await s.f(WD);
  assertEquals(s.calls(), 3);
});

Deno.test("hardcover is never stored", async () => {
  const s = await setup();
  await s.f("https://api.hardcover.app/v1/graphql", {
    method: "POST",
    body: "{}",
  });
  await s.f("https://api.hardcover.app/v1/graphql", {
    method: "POST",
    body: "{}",
  });
  assertEquals(s.calls(), 2);
  assertEquals(s.mem.files.size, 0);
});

Deno.test("rematch-cached output is the same with and without --cache-dir", async () => {
  const run = async (extra: string[]) => {
    const lines: string[] = [];
    const deps: Partial<RunDeps> = {
      loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
      openProdDb: (() =>
        Promise.resolve({
          end: () => Promise.resolve(),
        })) as unknown as RunDeps[
          "openProdDb"
        ],
      checkHardcoverBudget: () => Promise.resolve(true),
      hardcoverDailyRemaining: () => Promise.resolve(5000),
      loadWorks: () => Promise.resolve([]),
      authorStore: () => memoryAuthorStore(),
      loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
      wikidataHebrewAuthors: () => Promise.resolve(new Map()),
      sleep: () => Promise.resolve(),
      now: () => new Date(0),
      log: (m) => lines.push(m),
      error: () => {},
    };
    const code = await main(extra, deps);
    return { code, lines };
  };
  const plain = await run([]);
  const cached = await run(["--cache-dir", "/tmp/unused-cache"]);
  assertEquals(cached, plain);
});
