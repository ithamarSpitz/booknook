import { assertEquals } from "jsr:@std/assert@1";
import { isPrefixOnlyMatch, resolveMatch } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const none = async () => null;

function hc(id: number, title: string, author: string): HardcoverBook {
  return {
    id,
    title,
    cached_contributors: [{ author: { name: author } }],
    cached_similar_book_ids: [],
  };
}

const bolvangar = hc(1135414, "Northern Lights: Bolvangar", "Philip Pullman");
const compass = hc(355708, "The Golden Compass", "Philip Pullman");

function setup(title: string, author: string) {
  const ed = edition({ simania_id: 100, title, author }) as EditionRow;
  return { ed, db: new FakeDb({ editions: [ed] }) };
}

const wdBridge = { title: "Northern Lights", author: "Philip Pullman", source: "Wikidata" as const };
const nliBridge = { title: "Golden Compass", author: "Philip Pullman", source: "NLI" as const };

function finder(books: HardcoverBook[]) {
  return async (title: string) => books.find((b) => b.title.includes(title)) ?? null;
}

Deno.test("prefix-only Wikidata match is replaced by a full NLI match", async () => {
  const { ed, db } = setup("המצפן הזהוב", "פולמן, פיליפ");
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => wdBridge,
    nliOriginal: async () => nliBridge,
    wikidataEnglishAuthor: none,
    findHardcoverBook: finder([bolvangar, compass]),
  });
  assertEquals(result.found?.book.id, 355708);
  assertEquals(result.found?.status, "nli");
});

Deno.test("prefix-only Wikidata match stays when NLI finds nothing", async () => {
  const { ed, db } = setup("המצפן הזהוב", "פולמן, פיליפ");
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => wdBridge,
    nliOriginal: none,
    wikidataEnglishAuthor: none,
    findHardcoverBook: finder([bolvangar]),
  });
  assertEquals(result.found?.book.id, 1135414);
  assertEquals(result.found?.status, "wikidata");
});

Deno.test("NLI prefix-only match does not replace the Wikidata match", async () => {
  const nickel = hc(777, "The Nickel Boys: A Novel", "Colson Whitehead");
  const { ed, db } = setup("בני הניקל", "וייטהד, קולסון");
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "The Nickel Boys",
      author: "Colson Whitehead",
      source: "Wikidata" as const,
    }),
    nliOriginal: async () => ({
      title: "Nickel Boys",
      author: "Colson Whitehead",
      source: "NLI" as const,
    }),
    wikidataEnglishAuthor: none,
    findHardcoverBook: async () => nickel,
  });
  assertEquals(result.found?.book.id, 777);
  assertEquals(result.found?.status, "wikidata");
});

Deno.test("full-title Wikidata match never calls NLI", async () => {
  const { ed, db } = setup("המצפן הזהוב", "פולמן, פיליפ");
  let calls = 0;
  const full = hc(1, "Northern Lights", "Philip Pullman");
  const result = await resolveMatch(db, ed, {
    now: () => NOW,
    wikidataOriginal: async () => wdBridge,
    nliOriginal: async () => {
      calls += 1;
      return nliBridge;
    },
    wikidataEnglishAuthor: none,
    findHardcoverBook: async () => full,
  });
  assertEquals(result.found?.status, "wikidata");
  assertEquals(calls, 0);
});

Deno.test("isPrefixOnlyMatch", () => {
  assertEquals(isPrefixOnlyMatch("Northern Lights", "Northern Lights: Bolvangar"), true);
  assertEquals(isPrefixOnlyMatch("Northern Lights", "Northern Lights"), false);
  assertEquals(isPrefixOnlyMatch("Northern Lights", "The Golden Compass"), false);
});
