import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import { resolveMatch } from "../../supabase/functions/_shared/catalog.ts";

Deno.test("provider failure skip includes the Wikidata error detail", async () => {
  const lines: string[] = [];
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({
        end: () => Promise.resolve(),
      })) as unknown as RunDeps["openProdDb"],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () =>
      Promise.resolve([{
        id: "work-1",
        hardcover_id: 434661,
        original_title: "The Painted Veil",
        original_authors: ["Stephen King"],
      }]),
    authorStore: () => memoryAuthorStore(),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    loadEdition: () => Promise.resolve(null),
    wikidataHebrewAuthors: () => Promise.resolve(new Map()),
    hebrewHint: () => Promise.resolve({ title: "הצעיף הצבעוני" }),
    matchHebrewBook: () =>
      Promise.resolve({ id: 1234, title: "הצעיף הצבעוני" }),
    fetchEditionDetails: () =>
      Promise.resolve({
        simania_id: 1234,
        title: "הצעיף הצבעוני",
        author: "סטיבן קינג",
      }),
    resolveMatch: (db, edition) =>
      resolveMatch(db, edition, {
        wikidataOriginal: () => Promise.reject(new Error("boom")),
        nliOriginal: () => Promise.resolve(null),
        findHardcoverBook: () => Promise.resolve(null),
      }),
    log: (line) => lines.push(line),
  };

  assertEquals(await main([], deps), 0);
  assertEquals(JSON.parse(lines[0]), {
    hardcover_id: 434661,
    title: "The Painted Veil",
    skipped: "provider_failure",
    failures: [{ provider: "wikidata", error: "boom" }],
  });
});

Deno.test("resolveMatch reports a failed author-hint query as db", async () => {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    not() {
      return this;
    },
    neq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return Promise.reject(new Error("db boom"));
    },
  };
  const result = await resolveMatch(
    { from: () => query },
    {
      simania_id: 1234,
      work_id: null,
      resolve_status: "pending",
      resolved_at: null,
      title: "הצעיף הצבעוני",
      author: "סומרסט מוהם",
      translator: null,
      publisher: null,
      series: null,
      category: null,
      year: null,
      pages: null,
      description: null,
      cover_url: null,
      simania_rating: null,
      simania_rating_count: null,
      details_at: null,
    },
    {
      wikidataOriginal: () => Promise.resolve(null),
      nliOriginal: () =>
        Promise.resolve({
          title: "The Painted Veil",
          author: "",
          source: "NLI",
        }),
      findHardcoverBook: () => Promise.resolve(null),
    },
  );

  assertEquals(result.failures, [{ provider: "db", error: "db boom" }]);
});

Deno.test("author_books NLI failure is recorded in failures", async () => {
  const lines: string[] = [];
  let nliCalls = 0;
  const hc = {
    id: 11,
    title: "Catching Fire",
    cached_contributors: [{ author: { name: "Suzanne Collins" } }],
  };
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({
        end: () => Promise.resolve(),
      })) as unknown as RunDeps["openProdDb"],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () =>
      Promise.resolve([{
        id: "w1",
        hardcover_id: 11,
        original_title: "Catching Fire",
        original_authors: ["Suzanne Collins"],
      }]),
    authorStore: () => memoryAuthorStore(),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    loadEdition: () => Promise.resolve(null),
    insertEdition: () => Promise.resolve(),
    wikidataHebrewAuthors: () =>
      Promise.resolve(new Map([["Suzanne Collins", ["סוזן קולינס"]]])),
    wikidataOriginals: () => Promise.resolve(new Map()),
    nliOriginal: () =>
      ++nliCalls === 1
        ? Promise.resolve(null)
        : Promise.reject(new Error("nli boom")),
    wiktionaryGlosses: () => Promise.resolve([]),
    hebrewHint: () => Promise.resolve(null),
    matchHebrewBook: () => Promise.resolve({ id: 101 }),
    searchBooks: () =>
      Promise.resolve([{ id: 101, title: "התלקחות", author: "סוזן קולינס" }]),
    hebrewAuthorBySound: () => Promise.resolve(null),
    resolveMatch: () =>
      Promise.resolve({
        found: { book: hc, status: "wikidata" as const },
        failed: false,
        failures: [],
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
    fetchEditionDetails: (id) =>
      Promise.resolve({
        simania_id: id,
        title: "התלקחות",
        author: "סוזן קולינס",
      }),
    sleep: () => Promise.resolve(),
    now: () => new Date(0),
    log: (line) => lines.push(line),
    error: () => {},
  };
  await main([], deps);
  const line = JSON.parse(lines[0]);
  assertEquals(line.skipped, "provider_failure");
  assertEquals(line.failures[0].provider, "nli");
});
