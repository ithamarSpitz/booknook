import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  decideHebrewEdition,
  decideMissedTranslation,
  decideWrongLink,
  type MeasureProviders,
  sampleLinkedWorks,
} from "../../scripts/measure-links.ts";

const HEBREW_EDITION = {
  simania_id: 101,
  title: "התלקחות",
  author: "סוזן קולינס",
};

function hebrewProviders(options: {
  nli?: string | null;
  wikidata?: string | null;
  translator?: string | null;
}) {
  return {
    nliOriginal: () =>
      Promise.resolve(options.nli ? { title: options.nli } : null),
    wikidataOriginal: () =>
      Promise.resolve(
        options.wikidata ? { title: options.wikidata } : null,
      ),
    bookDetails: () =>
      Promise.resolve({ translator: options.translator ?? null }),
  };
}

Deno.test("Hebrew edition decision covers all four kinds", async () => {
  assertEquals(
    await decideHebrewEdition(
      HEBREW_EDITION,
      hebrewProviders({ nli: "Catching Fire" }),
    ),
    "translation_with_original",
  );
  assertEquals(
    await decideHebrewEdition(
      HEBREW_EDITION,
      hebrewProviders({ translator: "יעל אכמון" }),
    ),
    "translated_no_original",
  );

  const failing = hebrewProviders({});
  failing.nliOriginal = () => Promise.reject(new Error("NLI unavailable"));
  assertEquals(
    await decideHebrewEdition(HEBREW_EDITION, failing),
    "provider_failure",
  );
  assertEquals(
    await decideHebrewEdition(HEBREW_EDITION, hebrewProviders({})),
    "no_evidence",
  );
});

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

Deno.test("wrong-link decision covers agree, differ and unknown", async () => {
  const work = { original_title: "The Hunger Games: Book One", simania_id: 7 };
  const details = () =>
    Promise.resolve({ title: "משחקי הרעב", author: "סוזן קולינס" });

  assertEquals(
    await decideWrongLink(work, {
      bookDetails: details,
      nliOriginal: () => Promise.resolve({ title: "Hunger Games" }),
    }),
    { result: "agree", nliTitle: "Hunger Games" },
  );
  assertEquals(
    await decideWrongLink(work, {
      bookDetails: details,
      nliOriginal: () => Promise.resolve({ title: "Catching Fire" }),
    }),
    { result: "differ", nliTitle: "Catching Fire" },
  );
  assertEquals(
    await decideWrongLink(work, {
      bookDetails: details,
      nliOriginal: () => Promise.resolve(null),
    }),
    { result: "unknown", nliTitle: null },
  );
});

Deno.test("wrong-link sample keeps works 1, 4 and 7 from ten for n=3", () => {
  const works = Array.from({ length: 10 }, (_, index) => index + 1);
  assertEquals(sampleLinkedWorks(works, 3), [1, 4, 7]);
});
