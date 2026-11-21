import { assertEquals } from "jsr:@std/assert@1";
import { resolveMatch } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const none = async () => null;

const book: HardcoverBook = {
  id: 463025,
  title: "The Paris Apartment",
  cached_contributors: [{ author: { name: "Lucy Foley" } }],
  cached_similar_book_ids: [],
};

const bridge = { title: "The Paris Apartment", author: "Lucy Foley", source: "Wikidata" as const };
const nliBridge = { title: "The Paris Apartment", author: "פולי, לוסי", source: "NLI" as const };

function setup(over: Record<string, unknown> = {}) {
  const ed = edition({
    simania_id: 100,
    title: "דירה בפריז",
    author: "פולי, לוסי",
    ...over,
  }) as EditionRow;
  return { ed, db: new FakeDb({ editions: [ed] }) };
}

Deno.test("resolveMatch returns a wikidata hit without writing", async () => {
  const { ed, db } = setup();
  const before = JSON.stringify(db.tables);
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => bridge,
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: async () => book,
  });
  assertEquals(result.found?.status, "wikidata");
  assertEquals(result.found?.book, book);
  assertEquals(result.failed, false);
  assertEquals(JSON.stringify(db.tables), before);
  assertEquals(db.tables.works ?? [], []);
});

Deno.test("resolveMatch returns nli, fuzzy and null results", async () => {
  const { ed, db } = setup();
  const nli = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: none,
    nliOriginal: async () => nliBridge,
    wikidataEnglishAuthor: async () => "Lucy Foley",
    findHardcoverBook: async () => book,
  });
  assertEquals(nli.found?.status, "nli");

  const fuzzy = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: none,
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: async () => book,
  });
  assertEquals(fuzzy.found?.status, "fuzzy");

  const missing = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: none,
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: none,
  });
  assertEquals(missing.found, null);
  assertEquals(missing.failed, false);
});

Deno.test("resolveMatch reports provider failures", async () => {
  const { ed, db } = setup();
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => {
      throw new Error("down");
    },
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: none,
  });
  assertEquals(result.found, null);
  assertEquals(result.failed, true);
});

Deno.test("resolveMatch evaluates an already linked edition", async () => {
  const { ed, db } = setup({
    work_id: "work-1",
    resolve_status: "wikidata",
    resolved_at: "2026-10-20T10:00:00.000Z",
  });
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => bridge,
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: async () => book,
  });
  assertEquals(result.found?.status, "wikidata");
});
