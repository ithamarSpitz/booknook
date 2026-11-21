import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ProviderError,
  wikidataHebrewAuthors,
  wikidataOriginals,
} from "../../supabase/functions/_shared/bridges.ts";

async function withFetch(fetcher: typeof fetch, run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function sparql(bindings: unknown[]): Response {
  return new Response(JSON.stringify({ results: { bindings } }));
}

function queryOf(init?: RequestInit): string {
  return new URLSearchParams(String(init?.body)).get("query") ?? "";
}

Deno.test("wikidataHebrewAuthors sends one escaped request and groups labels", async () => {
  const queries: string[] = [];
  await withFetch(
    (_input, init) => {
      queries.push(queryOf(init));
      return Promise.resolve(sparql([
        { name: { value: "Wally Lamb" }, he: { value: "וולי למב" } },
        { name: { value: "Wally Lamb" }, he: { value: "ולי למב" } },
        { name: { value: "Wally Lamb" }, he: { value: "ולי למב" } },
      ]));
    },
    async () => {
      const result = await wikidataHebrewAuthors(["Wally Lamb", "Wally Lamb", " ", 'Rudyard "X" Kipling']);
      assertEquals(result, new Map([["Wally Lamb", ["וולי למב", "ולי למב"]]]));
    },
  );
  assertEquals(queries.length, 1);
  assertEquals(queries[0].split('"Wally Lamb"@en').length - 1, 1);
  assertEquals(queries[0].includes('"Rudyard \\"X\\" Kipling"@en'), true);
});

Deno.test("wikidataHebrewAuthors chunks 250 names into 100, 100 and 50", async () => {
  const counts: number[] = [];
  await withFetch(
    (_input, init) => {
      counts.push(queryOf(init).split("@en").length - 1);
      return Promise.resolve(sparql([]));
    },
    async () => {
      const names = Array.from({ length: 250 }, (_, i) => `Name ${i}`);
      assertEquals((await wikidataHebrewAuthors(names)).size, 0);
    },
  );
  assertEquals(counts, [100, 100, 50]);
});

Deno.test("wikidataOriginals keeps only work types with an English label", async () => {
  await withFetch(
    () =>
      Promise.resolve(sparql([
        {
          he: { value: "נדודי שינה" },
          type: { value: "http://www.wikidata.org/entity/Q7725634" },
          en: { value: "Insomnia" },
        },
        { he: { value: "עשב" }, type: { value: "http://www.wikidata.org/entity/Q5" }, en: { value: "Grass" } },
      ])),
    async () => {
      const result = await wikidataOriginals(["נדודי שינה", "עשב"]);
      assertEquals(result, new Map([["נדודי שינה", ["Insomnia"]]]));
    },
  );
});

Deno.test("batched Wikidata helpers throw ProviderError on bad responses", async () => {
  await withFetch(
    () => Promise.resolve(new Response("upstream request timeout", { status: 504 })),
    async () => {
      await assertRejects(() => wikidataHebrewAuthors(["Wally Lamb"]), ProviderError);
    },
  );
  await withFetch(
    () => Promise.resolve(new Response("upstream request timeout")),
    async () => {
      await assertRejects(() => wikidataOriginals(["נדודי שינה"]), ProviderError);
      await assertRejects(() => wikidataHebrewAuthors(["Wally Lamb"]), ProviderError);
    },
  );
});
