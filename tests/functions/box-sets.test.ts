import { assertEquals } from "jsr:@std/assert@1";
import { boxCore, isBoxSet, resolveMatch } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const none = async () => null;

Deno.test("isBoxSet matches whole words only", () => {
  for (
    const title of [
      "טרילוגיית משחקי הרעב",
      "מארז דיגיטלי – מורשת הותורן",
      "טרילוגיית חמישים גוונים של אפור - סט מלא",
    ]
  ) assertEquals(isBoxSet(title), true, title);
  for (const title of ["אידיוט", "סטודיו", "הסטודנטית", "התלקחות - משחקי הרעב 2"]) {
    assertEquals(isBoxSet(title), false, title);
  }
});

Deno.test("boxCore removes box words and keeps the longest part", () => {
  assertEquals(boxCore("טרילוגיית משחקי הרעב"), "משחקי הרעב");
  assertEquals(boxCore("מארז דיגיטלי – מורשת הותורן"), "מורשת הותורן");
  assertEquals(
    boxCore("טרילוגיית חמישים גוונים של אפור - סט מלא"),
    "חמישים גוונים של אפור",
  );
});

const trilogy: HardcoverBook = {
  id: 593165,
  title: "The Hunger Games Trilogy",
  cached_contributors: [{ author: { name: "Suzanne Collins" } }],
  cached_similar_book_ids: [],
};

function setup(title: string) {
  const ed = edition({
    simania_id: 980165,
    title,
    author: "קולינס, סוזן",
  }) as EditionRow;
  return { ed, db: new FakeDb({ editions: [ed] }) };
}

Deno.test("box set resolves through bridge title plus Trilogy", async () => {
  const { ed, db } = setup("טרילוגיית משחקי הרעב");
  const calls: { query: string; options: unknown }[] = [];
  const wikidataInputs: string[] = [];
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async (title: string) => {
      wikidataInputs.push(title);
      return { title: "The Hunger Games", author: "Suzanne Collins", source: "Wikidata" as const };
    },
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: async (query: string, _hint?: string, options?: unknown) => {
      calls.push({ query, options });
      const box = (options as { boxTitle?: boolean } | undefined)?.boxTitle;
      return query === "The Hunger Games Trilogy" && box ? trilogy : null;
    },
  });
  assertEquals(wikidataInputs, ["משחקי הרעב"]);
  assertEquals(result.found?.book.id, 593165);
  assertEquals(result.found?.status, "wikidata");
  assertEquals(calls.length > 0, true);
  assertEquals(calls.every((c) => (c.options as { boxTitle?: boolean }).boxTitle === true), true);
});

Deno.test("box set with no accepted book is null and skips fuzzy", async () => {
  const { ed, db } = setup("טרילוגיית משחקי הרעב");
  const queries: string[] = [];
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "The Hunger Games",
      author: "Suzanne Collins",
      source: "Wikidata" as const,
    }),
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: async (query: string) => {
      queries.push(query);
      return null;
    },
  });
  assertEquals(result.found, null);
  assertEquals(queries, [
    "The Hunger Games Trilogy",
    "The Hunger Games Collection",
    "The Hunger Games Box Set",
  ]);
});

Deno.test("non-box edition keeps the pre-S31 call sequence", async () => {
  const { ed, db } = setup("דירה בפריז");
  const calls: { query: string; options: unknown }[] = [];
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "The Paris Apartment",
      author: "Lucy Foley",
      source: "Wikidata" as const,
    }),
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: async (query: string, _hint?: string, options?: unknown) => {
      calls.push({ query, options });
      return null;
    },
  });
  assertEquals(result.found, null);
  assertEquals(calls, [
    { query: "The Paris Apartment", options: { retryWithAuthor: true } },
    { query: "דירה בפריז", options: { requireAuthor: true } },
  ]);
});
