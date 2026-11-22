import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  decideMissedTranslation,
  type MeasureProviders,
} from "../../scripts/measure-links.ts";

const WORK = {
  original_title: "Catching Fire",
  original_authors: ["Suzanne Collins"],
};

function providers(
  originals: { nli?: string | null; wikidata?: string | null },
): MeasureProviders {
  return {
    hebrewAuthor: () => Promise.resolve("סוזן קולינס"),
    searchBooks: (_query, _limit, offset) =>
      Promise.resolve(
        offset === 0
          ? [{ id: 101, title: "התלקחות", author: "סוזן קולינס" }]
          : [],
      ),
    nliOriginal: () =>
      Promise.resolve(originals.nli ? { title: originals.nli } : null),
    wikidataOriginal: () =>
      Promise.resolve(
        originals.wikidata ? { title: originals.wikidata } : null,
      ),
  };
}

Deno.test("NLI original equal to the English title is a missed translation", async () => {
  assertEquals(
    await decideMissedTranslation(
      WORK,
      new Set(),
      providers({ nli: "Catching Fire" }),
    ),
    { missed: true, failed: false },
  );
});

Deno.test("different candidate originals are not a missed translation", async () => {
  assertEquals(
    await decideMissedTranslation(
      WORK,
      new Set(),
      providers({ nli: "The Hunger Games", wikidata: "Mockingjay" }),
    ),
    { missed: false, failed: false },
  );
});

Deno.test("provider failure is counted and is not a missed translation", async () => {
  const failing = providers({});
  failing.hebrewAuthor = () => Promise.reject(new Error("provider down"));
  assertEquals(
    await decideMissedTranslation(WORK, new Set(), failing),
    { missed: false, failed: true },
  );
});
