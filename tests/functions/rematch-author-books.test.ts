import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

const work: RematchWork = {
  id: "w1",
  hardcover_id: 11,
  original_title: "Catching Fire",
  original_authors: ["Suzanne Collins"],
};
const hcBook: HardcoverBook = {
  id: 11,
  title: "Catching Fire",
  cached_contributors: [{ author: { name: "Suzanne Collins" } }],
};

function harness(
  options: {
    editionAuthor?: string;
    hint?: boolean;
    hintFails?: boolean;
    file?: string;
  } = {},
) {
  const lines: string[] = [];
  const calls = { search: 0, apply: [] as string[] };
  let nliCalls = 0;
  const reject = () => Promise.reject(new Error("forbidden"));
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({ end: () => Promise.resolve() })) as unknown as RunDeps[
        "openProdDb"
      ],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () => Promise.resolve([work]),
    authorStore: () => memoryAuthorStore(),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    loadEdition: () => Promise.resolve(null),
    insertEdition: () => Promise.resolve(),
    wikidataHebrewAuthors: () =>
      Promise.resolve(new Map([["Suzanne Collins", ["סוזן קולינס"]]])),
    wikidataOriginals: () => Promise.resolve(new Map()),
    // The reverse search asks first and gets nothing; the missed-translation
    // check asks later and gets the original.
    nliOriginal: () =>
      Promise.resolve(++nliCalls === 1 ? null : { title: "Catching Fire" }),
    wiktionaryGlosses: () => Promise.resolve([]),
    hebrewHint: options.hintFails
      ? reject
      : () =>
        Promise.resolve(
          options.hint ? { title: "התלקחות", author: "סוזן קולינס" } : null,
        ),
    matchHebrewBook: () => Promise.resolve({ id: 101 }),
    searchBooks: () => {
      calls.search++;
      return Promise.resolve([
        { id: 101, title: "התלקחות", author: "סוזן קולינס" },
      ]);
    },
    hebrewAuthorBySound: () => Promise.resolve(null),
    resolveMatch: () =>
      Promise.resolve({
        found: { book: hcBook, status: "wikidata" as const },
        failed: false,
        failures: [],
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
    fetchEditionDetails: (id) =>
      Promise.resolve({
        simania_id: id,
        title: "התלקחות",
        author: options.editionAuthor ?? "סוזן קולינס",
      }),
    applyRepair: (_sql, plan, _now, status) => {
      calls.apply.push(status);
      return Promise.resolve({
        simania_id: plan.simania_id,
        status: "linked" as const,
        work_id: "w",
      });
    },
    hardcoverBooks: (ids) => Promise.resolve(ids.map(() => hcBook)),
    readTextFile: () => Promise.resolve(options.file ?? ""),
    sleep: () => Promise.resolve(),
    now: () => new Date(0),
    log: (m) => lines.push(m),
    error: () => {},
  };
  return { deps, lines, calls };
}

Deno.test("author books proposes the Simania book whose NLI original matches", async () => {
  const h = harness();
  assertEquals(await main([], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).proposal, {
    simania_id: 101,
    book_id: 11,
    hebrew_title: "התלקחות",
    via: "author_books",
    status: "nli",
  });
});

Deno.test("author books gives no proposal when the author disagrees", async () => {
  const h = harness({ editionAuthor: "דן בראון" });
  await main([], h.deps);
  assertEquals(h.lines.some((l) => l.includes('"proposal"')), false);
  assertEquals(JSON.parse(h.lines[0]).skipped, "author_mismatch");
});

Deno.test("author books is not asked when another source proposed", async () => {
  const h = harness({ hint: true });
  await main([], h.deps);
  assertEquals(JSON.parse(h.lines[0]).proposal.via, "forward");
  assertEquals(h.calls.search, 0);
});

Deno.test("author books is not asked after a provider failure", async () => {
  const h = harness({ hintFails: true });
  await main([], h.deps);
  assertEquals(JSON.parse(h.lines[0]).skipped, "provider_failure");
  assertEquals(h.calls.search, 0);
});

Deno.test("--from --apply links an author_books line", async () => {
  const file = JSON.stringify({
    hardcover_id: 11,
    title: "Catching Fire",
    proposal: {
      simania_id: 101,
      book_id: 11,
      hebrew_title: "התלקחות",
      via: "author_books",
      status: "nli",
    },
  });
  const h = harness({ file });
  // The guard asks NLI again; a matching original is no mismatch.
  assertEquals(await main(["--from", "x", "--apply"], h.deps), 0);
  assertEquals(h.calls.apply, ["nli"]);
  assertEquals(JSON.parse(h.lines.at(-1)!), {
    proposals: 1,
    linked: 1,
    skipped: {},
  });
});
