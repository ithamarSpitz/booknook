import type { Sql } from "npm:postgres@3.4.5";
import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  classifyUnlinkedWork,
  decideHebrewEdition,
  decideMissedTranslation,
  decideWrongLink,
  findWikidataWork,
  type InUseWork,
  main,
  type MeasureProviders,
  type RunDeps,
  sampleLinkedWorks,
  type UnlinkedEvidenceProviders,
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
    { missed: true, failed: false, class: "missed" },
  );
});

Deno.test("different candidate originals are not a missed translation", async () => {
  assertEquals(
    await decideMissedTranslation(
      WORK,
      new Set(),
      providers({ nli: "The Hunger Games", wikidata: "Mockingjay" }),
    ),
    { missed: false, failed: false, class: "catalog_checked" },
  );
});

Deno.test("provider failure is counted and is not a missed translation", async () => {
  const failing = providers({});
  failing.hebrewAuthor = () => Promise.reject(new Error("provider down"));
  assertEquals(
    await decideMissedTranslation(WORK, new Set(), failing),
    { missed: false, failed: true, class: "failed" },
  );
});

function evidenceProviders(
  options: {
    label?: string | null;
    books?: Array<{ id: number; title: string; author: string }>;
    fail?: boolean;
  } = {},
): UnlinkedEvidenceProviders {
  return {
    hebrewAuthor: () => Promise.resolve(null),
    searchBooks: () => Promise.resolve(options.books ?? []),
    nliOriginal: () => Promise.resolve(null),
    wikidataOriginal: () => Promise.resolve(null),
    wikidataWork: () =>
      options.fail
        ? Promise.reject(new Error("Wikidata unavailable"))
        : Promise.resolve(
          options.label === undefined
            ? null
            : { id: "Q1", hebrewLabel: options.label },
        ),
  };
}

Deno.test("unlinked work classification covers every class", async () => {
  assertEquals(
    await classifyUnlinkedWork(WORK, new Set(), evidenceProviders()),
    { class: "no_hebrew_author" },
  );
  assertEquals(
    await classifyUnlinkedWork(
      WORK,
      new Set(),
      evidenceProviders({ fail: true }),
    ),
    { class: "failed" },
  );
  assertEquals(
    await classifyUnlinkedWork(
      WORK,
      new Set(),
      evidenceProviders({
        label: "התלקחות",
        books: [{ id: 101, title: "התלקחות", author: "סוזן קולינס" }],
      }),
    ),
    { class: "missed", via: "wikidata_he", hebrewLabel: "התלקחות" },
  );
  assertEquals(
    await classifyUnlinkedWork(
      WORK,
      new Set(),
      evidenceProviders({
        label: "התלקחות",
        books: [{ id: 102, title: "התלקחות", author: "עמוס עוז" }],
      }),
    ),
    { class: "hebrew_label_unconfirmed", hebrewLabel: "התלקחות" },
  );
});

Deno.test("Wikidata Hebrew label is searched with both apostrophe forms", async () => {
  const queries: string[] = [];
  const fake = evidenceProviders({ label: "ג'קיל", books: [] });
  fake.searchBooks = (query) => {
    queries.push(query);
    return Promise.resolve([]);
  };
  assertEquals(
    (await classifyUnlinkedWork(WORK, new Set(), fake)).class,
    "hebrew_label_unconfirmed",
  );
  assertEquals(queries, ["ג'קיל", "ג׳קיל"]);
});

Deno.test("Wikidata entity with a different author is not accepted", async () => {
  const fakeFetch = ((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action");
    if (action === "wbsearchentities") {
      return Promise.resolve(Response.json({ search: [{ id: "Q1" }] }));
    }
    if (url.searchParams.get("ids") === "Q1") {
      return Promise.resolve(Response.json({
        entities: {
          Q1: {
            labels: { he: { value: "התלקחות" } },
            descriptions: { en: { value: "novel by Another Writer" } },
            claims: {
              P50: [{
                mainsnak: { datavalue: { value: { id: "Q2" } } },
              }],
            },
          },
        },
      }));
    }
    return Promise.resolve(Response.json({
      entities: { Q2: { labels: { en: { value: "Another Writer" } } } },
    }));
  }) as typeof fetch;
  assertEquals(await findWikidataWork(WORK, fakeFetch), null);
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
    loadEditionWork: () => Promise.resolve(null),
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
      wikidataWork: () => Promise.resolve(null),
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
    failed_in_sample: 0,
    missed_estimate: 3,
    missed_rate: 0.3,
    missed_titles: ["Title 1"],
    missed: 3,
    hebrew_label_unconfirmed: 0,
    no_evidence: 7,
    failed: 0,
    missed_rate_low: 0.3,
    missed_rate_high: 0.3,
    hebrew_label_titles: [],
    catalog_checked: 7,
    no_english_author: 0,
    no_hebrew_author: 0,
    no_author_books: 0,
    catalog_truncated: 0,
    unbridged_books: 0,
    duplicate_work: 0,
    linked_other_work: 0,
    missed_rate_strict_high: 0.3,
    duplicate_titles: [],
    linked_other_titles: [],
    rechecked: 0,
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
    hebrew_label_unconfirmed: 0,
    no_evidence: 0,
    failed: 0,
    missed_rate_low: 1,
    missed_rate_high: 1,
    hebrew_label_titles: [],
    catalog_checked: 0,
    no_english_author: 0,
    no_hebrew_author: 0,
    no_author_books: 0,
    catalog_truncated: 0,
    unbridged_books: 0,
    duplicate_work: 0,
    linked_other_work: 0,
    missed_rate_strict_high: 1,
    duplicate_titles: [],
    linked_other_titles: [],
    rechecked: 0,
  });
});

Deno.test("--sample without --all is rejected before opening the database", async () => {
  const harness = measureHarness([]);
  assertEquals(await main(["--sample", "3"], harness.deps), 2);
  assertEquals(harness.loads(), { inUseLoads: 0, allLoads: 0, ended: 0 });
  assertEquals(harness.logs, []);
  assertEquals(harness.errors.length, 1);
});
