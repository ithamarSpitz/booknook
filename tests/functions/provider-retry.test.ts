import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fetchRetry, setProviderRetry } from "../../supabase/functions/_shared/utils.ts";
import { wikidataOriginal } from "../../supabase/functions/_shared/bridges.ts";
import { searchBooks } from "../../supabase/functions/_shared/simania.ts";
import { searchHardcoverBooks } from "../../supabase/functions/_shared/hardcover.ts";
import { callTool, setProviderRetry as setSimaniaRetry } from "../../public/js/simania.js";

/**
 * "hang": never answers, rejects with AbortError when the caller's timeout fires (its elapsed ms is recorded).
 * "abort": rejects with AbortError at once (stands in for a timeout when the real first timeout is 12 s).
 * { slow }: answers 200 after that many ms, unless aborted first.
 * number: answers with that HTTP status.
 */
type Step = "hang" | "abort" | { slow: number } | number;

const BODY = '{"result":{"content":[{"type":"text","text":"[]"}]},"search":[],"data":{"search":{"ids":[]}}}';

function stub(steps: Step[]) {
  const calls: string[] = [];
  const abortedAfterMs: number[] = [];
  const impl = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(String(url));
    const step = steps.shift() ?? 200;
    const started = Date.now();
    const aborted = () => new DOMException("aborted", "AbortError");
    if (step === "abort") return Promise.reject(aborted());
    if (step === "hang" || typeof step === "object") {
      return new Promise((resolve, reject) => {
        const timer = typeof step === "object"
          ? setTimeout(() => resolve(new Response(BODY, { status: 200 })), step.slow)
          : undefined;
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          abortedAfterMs.push(Date.now() - started);
          reject(aborted());
        });
      });
    }
    return Promise.resolve(new Response(BODY, { status: step }));
  };
  return { calls, abortedAfterMs, impl };
}

async function withStub<T>(steps: Step[], run: (s: ReturnType<typeof stub>) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const s = stub(steps);
  globalThis.fetch = s.impl as typeof fetch;
  try {
    return await run(s);
  } finally {
    globalThis.fetch = original;
    setProviderRetry(null);
    setSimaniaRetry(null);
  }
}

const policy = { timeoutMs: 300, pauseMs: 1 };

Deno.test("no policy: abort throws on first attempt", async () => {
  await withStub(["hang", 200], async (s) => {
    await assertRejects(() => fetchRetry("https://example.org/x", {}, 20));
    assertEquals(s.calls.length, 1);
  });
});

Deno.test("policy: abort then a slow success uses the longer timeout", async () => {
  // The retry answers after 100 ms: past the 20 ms first timeout, inside the 300 ms policy timeout.
  await withStub(["hang", { slow: 100 }], async (s) => {
    setProviderRetry(policy);
    const response = await fetchRetry("https://example.org/x", {}, 20);
    assertEquals(response.status, 200);
    assertEquals(s.calls.length, 2);
    assertEquals(s.abortedAfterMs.length, 1);
  });
});

Deno.test("policy: two aborts throw, the second after the policy timeout", async () => {
  await withStub(["hang", "hang", 200], async (s) => {
    setProviderRetry({ timeoutMs: 120, pauseMs: 1 });
    await assertRejects(() => fetchRetry("https://example.org/x", {}, 20));
    assertEquals(s.calls.length, 2);
    assert(s.abortedAfterMs[0] < 100, `first attempt aborted after ${s.abortedAfterMs[0]} ms`);
    assert(s.abortedAfterMs[1] >= 100, `retry aborted after ${s.abortedAfterMs[1]} ms`);
  });
});

Deno.test("policy: 502 then 200 succeeds; 502 twice returns the second 502", async () => {
  await withStub([502, 200], async (s) => {
    setProviderRetry(policy);
    assertEquals((await fetchRetry("https://example.org/x", {}, 20)).status, 200);
    assertEquals(s.calls.length, 2);
  });
  await withStub([502, 502, 200], async (s) => {
    setProviderRetry(policy);
    assertEquals((await fetchRetry("https://example.org/x", {}, 20)).status, 502);
    assertEquals(s.calls.length, 2);
  });
});

Deno.test("providerFetch (wikidata): abort then success retries; 502 is retried once, not twice", async () => {
  await withStub(["abort", 200], async (s) => {
    setProviderRetry(policy);
    assertEquals(await wikidataOriginal("ספר"), null);
    assertEquals(s.calls.length, 2);
  });
  await withStub([502, 200], async (s) => {
    setProviderRetry(policy);
    assertEquals(await wikidataOriginal("ספר"), null);
    assertEquals(s.calls.length, 2);
  });
  await withStub([502, 502, 200], async (s) => {
    setProviderRetry(policy);
    await assertRejects(() => wikidataOriginal("ספר"));
    assertEquals(s.calls.length, 2);
  });
});

Deno.test("providerFetch (wikidata): no policy aborts once", async () => {
  await withStub(["abort", 200], async (s) => {
    await assertRejects(() => wikidataOriginal("ספר"));
    assertEquals(s.calls.length, 1);
  });
});

Deno.test("providerFetch (wikidata): retry after abort waits up to the policy timeout", async () => {
  await withStub(["abort", "hang"], async (s) => {
    setProviderRetry({ timeoutMs: 80, pauseMs: 1 });
    await assertRejects(() => wikidataOriginal("ספר"));
    assertEquals(s.calls.length, 2);
    assert(s.abortedAfterMs[0] >= 60 && s.abortedAfterMs[0] < 1000, `retry aborted after ${s.abortedAfterMs[0]} ms`);
  });
});

Deno.test("simania server callTool: retries abort and 502 with the policy, not without", async () => {
  await withStub(["abort", 200], async (s) => {
    await assertRejects(() => searchBooks("ספר"));
    assertEquals(s.calls.length, 1);
  });
  for (const first of ["abort", 502] as Step[]) {
    await withStub([first, 200], async (s) => {
      setProviderRetry(policy);
      assertEquals(await searchBooks("ספר"), []);
      assertEquals(s.calls.length, 2);
    });
  }
  await withStub(["abort", "hang"], async (s) => {
    setProviderRetry({ timeoutMs: 80, pauseMs: 1 });
    await assertRejects(() => searchBooks("ספר"));
    assertEquals(s.calls.length, 2);
    assert(s.abortedAfterMs[0] >= 60 && s.abortedAfterMs[0] < 1000, `retry aborted after ${s.abortedAfterMs[0]} ms`);
  });
});

Deno.test("hardcover is not retried on abort or 502 even with the policy", async () => {
  Deno.env.set("HARDCOVER_API_KEY", "test-key");
  for (const first of ["abort", 502] as Step[]) {
    await withStub([first, 200], async (s) => {
      setProviderRetry(policy);
      await assertRejects(() => searchHardcoverBooks("book"));
      assertEquals(s.calls.length, 1);
      assert(s.calls[0].includes("hardcover"));
    });
  }
});

Deno.test("simania client: no policy aborts once", async () => {
  const s = stub(["abort", 200]);
  await assertRejects(() => callTool("books_search", {}, s.impl as typeof fetch));
  assertEquals(s.calls.length, 1);
});

Deno.test("simania client: abort/502 then success; two failures throw", async () => {
  setSimaniaRetry({ timeoutMs: 100, pauseMs: 1 });
  try {
    for (const first of ["abort", 502] as Step[]) {
      const s = stub([first, 200]);
      assertEquals(await callTool("books_search", {}, s.impl as typeof fetch), []);
      assertEquals(s.calls.length, 2);
    }
    const s = stub([502, 502, 200]);
    await assertRejects(() => callTool("books_search", {}, s.impl as typeof fetch));
    assertEquals(s.calls.length, 2);
    const t = stub(["abort", "abort", 200]);
    await assertRejects(() => callTool("books_search", {}, t.impl as typeof fetch));
    assertEquals(t.calls.length, 2);
  } finally {
    setSimaniaRetry(null);
  }
});

Deno.test("simania client: retry uses the policy timeout, not the 12 s default", async () => {
  setSimaniaRetry({ timeoutMs: 80, pauseMs: 1 });
  try {
    const s = stub(["abort", "hang"]);
    await assertRejects(() => callTool("books_search", {}, s.impl as typeof fetch));
    assertEquals(s.calls.length, 2);
    assert(s.abortedAfterMs[0] >= 60 && s.abortedAfterMs[0] < 1000, `retry aborted after ${s.abortedAfterMs[0]} ms`);
    // A slow retry that would have been fine under a longer timeout succeeds within the policy timeout.
    const t = stub(["abort", { slow: 40 }]);
    assertEquals(await callTool("books_search", {}, t.impl as typeof fetch), []);
  } finally {
    setSimaniaRetry(null);
  }
});
