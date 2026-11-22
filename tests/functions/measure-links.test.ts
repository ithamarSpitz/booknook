import type { Sql } from "npm:postgres@3.4.5";
import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  decideHebrewEdition,
  decideMissedTranslation,
  decideWrongLink,
  type InUseWork,
  main,
  type MeasureProviders,
  type RunDeps,
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

function measureHarness(works: InUseWork[]) {
  const logs: string[] = [];
  const errors: string[] = [];
  let inUseLoads = 0;
  let allLoads = 0;
  let ended = 0;
  const sql = { end: () => ended++ } as unknown as Sql;
  const deps: Partial<RunDeps> = {
    openProdDb: (() => Promise.resolve(sql)) as RunDeps["openProdDb"],
    loadInUseWorks: () => {
      inUseLoads++;
      return Promise.resolve(works.slice(0, 1));
    },
    loadAllWorks: () => {
      allLoads++;
      return Promise.resolve(works);
    },
    loadLinkedSimaniaIds: () => Promise.resolve(new Set()),
    providers: {
      hebrewAuthor: (author) => Promise.resolve(`he-${author}`),
      searchBooks: (_query, _limit, offset) =>
        Promise.resolve(
          offset === 0
            ? [{ id: 100, title: "ספר", author: "he-Author 1" }]
            : [],
        ),
      nliOriginal: () => Promise.resolve({ title: "Title 1" }),
      wikidataOriginal: () => Promise.resolve(null),
    },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };
  return {
    deps,
    logs,
    errors,
    loads: () => ({ inUseLoads, allLoads, ended }),
  };
}

Deno.test("--all switches population and --sample checks works 1, 4 and 7", async () => {
  const works = Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1).padStart(2, "0"),
    original_title: `Title ${index + 1}`,
    original_authors: [`Author ${index + 1}`],
    has_hebrew: false,
    simania_id: null,
  }));
  const harness = measureHarness(works);
  const checkedAuthors: string[] = [];
  harness.deps.providers!.hebrewAuthor = (author) => {
    checkedAuthors.push(author);
    return Promise.resolve("he-Author 1");
  };

  assertEquals(await main(["--all", "--sample", "3"], harness.deps), 0);
  assertEquals(harness.loads(), { inUseLoads: 0, allLoads: 1, ended: 1 });
  assertEquals(checkedAuthors, ["Author 1", "Author 4", "Author 7"]);
  assertEquals(JSON.parse(harness.logs[0]), {
    all_works: 10,
    unlinked: 10,
    sampled: 3,
    missed_in_sample: 1,
    failed: 0,
    missed_estimate: 3,
    missed_rate: 0.3,
    missed_titles: ["Title 1"],
  });
});

Deno.test("without --all the in-use population and legacy JSON stay unchanged", async () => {
  const harness = measureHarness([{
    id: "01",
    original_title: "Title 1",
    original_authors: ["Author 1"],
    has_hebrew: false,
    simania_id: null,
  }]);

  assertEquals(await main([], harness.deps), 0);
  assertEquals(harness.loads(), { inUseLoads: 1, allLoads: 0, ended: 1 });
  assertEquals(JSON.parse(harness.logs[0]), {
    in_use_works: 1,
    unlinked_in_use: 1,
    missed: 1,
    missed_rate: 1,
    missed_titles: ["Title 1"],
  });
});

Deno.test("--sample without --all is rejected before opening the database", async () => {
  const harness = measureHarness([]);
  assertEquals(await main(["--sample", "3"], harness.deps), 2);
  assertEquals(harness.loads(), { inUseLoads: 0, allLoads: 0, ended: 0 });
  assertEquals(harness.logs, []);
  assertEquals(harness.errors.length, 1);
});
