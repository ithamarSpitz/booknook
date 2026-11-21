import { assertEquals } from "jsr:@std/assert@1";
import {
  type HardcoverBook,
  hardcoverHebrewEdition,
} from "../../supabase/functions/_shared/hardcover.ts";
import { defaultHebrewHint } from "../../supabase/functions/recommendations/index.ts";

Deno.env.set("HARDCOVER_API_KEY", "test-token");

function stubFetch(editions: Array<{ title: string }>) {
  const original = globalThis.fetch;
  const queries: string[] = [];
  globalThis.fetch = (_input, init) => {
    queries.push(JSON.parse(String(init?.body)).query as string);
    return Promise.resolve(Response.json({ data: { editions } }));
  };
  return { queries, restore: () => (globalThis.fetch = original) };
}

const book: HardcoverBook = {
  id: 325603,
  title: "Skinny",
  users_read_count: 1,
  cached_contributors: [{ author: { name: "Diana Spechler" } }],
};

Deno.test("hardcoverHebrewEdition requests the top Hebrew edition", async () => {
  const stub = stubFetch([{ title: " רזה " }]);
  try {
    assertEquals(await hardcoverHebrewEdition(325603), "רזה");
    assertEquals(stub.queries.length, 1);
    const q = stub.queries[0].replace(/\s+/g, "");
    for (const part of ["language:{code2:{_eq:\"he\"}}", "book_id:{_eq:325603}", "limit:1"]) {
      assertEquals(q.includes(part), true, part);
    }
  } finally {
    stub.restore();
  }
});

Deno.test("hardcoverHebrewEdition returns null without editions", async () => {
  const stub = stubFetch([]);
  try {
    assertEquals(await hardcoverHebrewEdition(1), null);
  } finally {
    stub.restore();
  }
});

Deno.test("defaultHebrewHint falls back to the Hardcover Hebrew edition", async () => {
  const hint = await defaultHebrewHint(book, {
    wikidataHebrew: () => Promise.resolve(null),
    nliHebrew: () => Promise.resolve(null),
    hardcoverHebrewEdition: () => Promise.resolve("רזה"),
  });
  assertEquals(hint, { source: "hardcover", title: "רזה", author: null });
});

Deno.test("defaultHebrewHint skips Hardcover when Wikidata answers", async () => {
  let calls = 0;
  const hint = await defaultHebrewHint(book, {
    wikidataHebrew: () => Promise.resolve({ title: "רזה", author: "דיאנה", source: "Wikidata" as const }),
    nliHebrew: () => Promise.resolve(null),
    hardcoverHebrewEdition: () => {
      calls++;
      return Promise.resolve("אחר");
    },
  });
  assertEquals(hint?.source, "wikidata");
  assertEquals(calls, 0);
});

Deno.test("defaultHebrewHint returns null when the Hardcover bridge throws", async () => {
  const hint = await defaultHebrewHint(book, {
    wikidataHebrew: () => Promise.resolve(null),
    nliHebrew: () => Promise.resolve(null),
    hardcoverHebrewEdition: () => Promise.reject(new Error("boom")),
  });
  assertEquals(hint, null);
});
