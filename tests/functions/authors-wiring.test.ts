import { assertEquals } from "jsr:@std/assert@1";
import { resolveMatch } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { hebrewAuthorFor } from "../../supabase/functions/recommendations/index.ts";
import { createHandler } from "../../supabase/functions/link-edition/index.ts";
import { nameKey } from "../../supabase/functions/_shared/authors.ts";
import { wikidataHebrewAuthor } from "../../supabase/functions/_shared/bridges.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";
import { serviceCatalogDb } from "../../scripts/recheck-links.ts";

function authorTables(he: string, en: string) {
  return {
    authors: [{ id: "a1", wikidata_checked_at: null }],
    author_names: [
      { author_id: "a1", lang: "en", name: en, name_key: nameKey(en), source: "link" },
      { author_id: "a1", lang: "he", name: he, name_key: nameKey(he), source: "link" },
    ],
  };
}

Deno.test("hebrewAuthorFor returns the table name without calling Wikidata", async () => {
  const db = new FakeDb(authorTables("וולי למב", "Wally Lamb"));
  let calls = 0;
  const result = await hebrewAuthorFor(
    db as never,
    "Wally Lamb",
    { wikidataHebrewAuthor: async () => (calls++, "לא") },
    new Map(),
  );
  assertEquals(result, "וולי למב");
  assertEquals(calls, 0);
});

Deno.test("hebrewAuthorFor ignores a linked edition's author and asks Wikidata", async () => {
  const db = new FakeDb({
    authors: [],
    author_names: [],
    works: [{ id: "w1", original_authors: ["Alice Feeney"] }],
    editions: [edition({ simania_id: 5, work_id: "w1", author: "הולי ג'קסון" })],
  });
  const asked: string[] = [];
  const result = await hebrewAuthorFor(
    db as never,
    "Alice Feeney",
    { wikidataHebrewAuthor: async (name) => (asked.push(name), "אליס פיני") },
    new Map(),
  );
  assertEquals(result, "אליס פיני");
  assertEquals(asked, ["Alice Feeney"]);
});

Deno.test("hebrewAuthorFor does not cache a Wikidata failure", async () => {
  const db = new FakeDb({ authors: [], author_names: [] });
  let calls = 0;
  const deps = {
    wikidataHebrewAuthor: async () => {
      calls++;
      throw new Error("429");
    },
  };
  const cache = new Map<string, string | null>();
  assertEquals(await hebrewAuthorFor(db as never, "Neil Gaiman", deps, cache), null);
  assertEquals(await hebrewAuthorFor(db as never, "Neil Gaiman", deps, cache), null);
  assertEquals(calls, 2);
  assertEquals(cache.size, 0);
});

Deno.test("resolveMatch uses the table's English name as the author hint", async () => {
  const ed = edition({ simania_id: 100, title: "דירה בפריז", author: "פולי, לוסי" }) as EditionRow;
  const db = new FakeDb({
    editions: [ed],
    ...authorTables("פולי, לוסי", "Lucy Foley"),
  });
  const book: HardcoverBook = {
    id: 1,
    title: "The Paris Apartment",
    cached_contributors: [{ author: { name: "Lucy Foley" } }],
    cached_similar_book_ids: [],
  };
  const hints: string[] = [];
  let wikidataCalls = 0;
  await resolveMatch(db, ed, {
    now: () => new Date("2026-10-25T10:00:00.000Z"),
    wikidataOriginal: async () => null,
    nliOriginal: async () => ({ title: "The Paris Apartment", author: "פולי, לוסי", source: "NLI" as const }),
    wikidataEnglishAuthor: async () => (wikidataCalls++, null),
    findHardcoverBook: async (_title: string, author?: string) => {
      hints.push(author ?? "");
      return book;
    },
  } as never);
  assertEquals(hints[0], "Lucy Foley");
  assertEquals(wikidataCalls, 0);
});

Deno.test("resolveMatch supports a read-only operator catalog adapter", async () => {
  const sql = (() => Promise.resolve([])) as never;
  const db = serviceCatalogDb(sql);
  const ed = edition({ simania_id: 101, title: "דירה בפריז", author: "פולי, לוסי" }) as EditionRow;
  const hints: string[] = [];
  let wikidataCalls = 0;
  const result = await resolveMatch(db, ed, {
    now: () => new Date("2026-10-25T10:00:00.000Z"),
    wikidataOriginal: async () => null,
    nliOriginal: async () => ({ title: "The Paris Apartment", author: "פולי, לוסי", source: "NLI" as const }),
    wikidataEnglishAuthor: async () => (wikidataCalls++, "Lucy Foley"),
    findHardcoverBook: async (_title: string, author?: string) => {
      hints.push(author ?? "");
      return {
        id: 1,
        title: "The Paris Apartment",
        cached_contributors: [{ author: { name: "Lucy Foley" } }],
        cached_similar_book_ids: [],
      } as HardcoverBook;
    },
  } as never);
  assertEquals(hints[0], "Lucy Foley");
  assertEquals(wikidataCalls, 1);
  assertEquals(result.failed, false);
});

Deno.test("hebrewAuthorFor upgrades the live gate's lenient bridge to strict", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const db = new FakeDb({ authors: [], author_names: [] });
    const cache = new Map<string, string | null>();
    const deps = { wikidataHebrewAuthor };
    assertEquals(await hebrewAuthorFor(db as never, "Neil Gaiman", deps, cache), null);
    assertEquals(await hebrewAuthorFor(db as never, "Neil Gaiman", deps, cache), null);
    assertEquals(calls, 2);
    assertEquals(cache.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const simania = {
  details: { title: "הנסיך הקטן", author: "וולי למב", coverUrl: "https://c/1.jpg" },
  rating: { rating: 4.5, count: 10 },
};

function linkSetup(recordPair: (...args: any[]) => Promise<void>) {
  const db = new FakeDb({
    editions: [],
    works: [{ id: "work-1", original_title: "She's Come Undone", original_authors: ["Wally Lamb"] }],
    recommendations: [{ user_id: "user-1", work_id: "work-1", simania_id: null, dismissed: false }],
    genre_recommendations: [],
  });
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => db,
    userClient: () => db,
    recordPair: recordPair as never,
  });
  const request = new Request("http://local/link-edition", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify({ work_id: "work-1", simania_id: 77, source: "wikidata", simania }),
  });
  return { handler, request };
}

Deno.test("link-edition records the author pair after a successful link", async () => {
  const pairs: Array<[string, string]> = [];
  const { handler, request } = linkSetup(async (_store, he, en) => {
    pairs.push([he, en]);
  });
  assertEquals((await handler(request)).status, 200);
  assertEquals(pairs, [["וולי למב", "Wally Lamb"]]);
});

Deno.test("link-edition still succeeds when recordPair fails", async () => {
  const { handler, request } = linkSetup(async () => {
    throw new Error("db down");
  });
  const response = await handler(request);
  assertEquals(response.status, 200);
  assertEquals((await response.json()).simania_id, 77);
});
