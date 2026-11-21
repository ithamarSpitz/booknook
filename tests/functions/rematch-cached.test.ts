import { assert, assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

const work = (hardcover_id: number): RematchWork => ({
  id: `w${hardcover_id}`,
  hardcover_id,
  original_title: "Thinner",
  original_authors: ["Stephen King"],
});

const book: HardcoverBook = {
  id: 325603,
  title: "Thinner",
  cached_contributors: [{ author: { name: "Stephen King" } }],
};

function harness(over: Partial<RunDeps> = {}, works = [work(325603)]) {
  const lines: string[] = [];
  const errors: string[] = [];
  const calls = { apply: [] as string[], insert: 0, wikidataAuthors: 0 };
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({ end: () => Promise.resolve() })) as unknown as RunDeps[
        "openProdDb"
      ],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () => Promise.resolve(works),
    loadLinkPairs: () => Promise.resolve([]),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    loadEdition: () => Promise.resolve(null),
    insertEdition: () => {
      calls.insert++;
      return Promise.resolve();
    },
    wikidataHebrewAuthors: () => {
      calls.wikidataAuthors++;
      return Promise.resolve(new Map());
    },
    wikidataOriginals: () => Promise.resolve(new Map()),
    nliOriginal: () => Promise.resolve(null),
    hebrewHint: () => Promise.resolve({ title: "רזה" }),
    matchHebrewBook: () => Promise.resolve({ id: 3191, title: "רזה" }),
    searchBooks: () => Promise.resolve([]),
    fetchEditionDetails: (id) =>
      Promise.resolve({ simania_id: id, title: "רזה", author: "סטיבן קינג" }),
    resolveMatch: () =>
      Promise.resolve({
        found: { book, status: "wikidata" },
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
    applyRepair: (_sql, plan, _now, status) => {
      calls.apply.push(status);
      return Promise.resolve({
        simania_id: plan.simania_id,
        status: "linked" as const,
        work_id: "w",
      });
    },
    hardcoverBooks: () => Promise.resolve([book]),
    now: () => new Date(0),
    log: (m) => lines.push(m),
    error: (m) => errors.push(m),
    ...over,
  };
  return { deps, lines, errors, calls };
}

const last = (lines: string[]) => JSON.parse(lines[lines.length - 1]);

Deno.test("dry run proposes without writing", async () => {
  const h = harness();
  const code = await main(["--hardcover-id", "325603"], h.deps);
  assertEquals(code, 0);
  assertEquals(JSON.parse(h.lines[0]), {
    hardcover_id: 325603,
    title: "Thinner",
    proposal: {
      simania_id: 3191,
      hebrew_title: "רזה",
      via: "forward",
      status: "wikidata",
    },
  });
  assertEquals(last(h.lines), {
    works: 1,
    proposals: 1,
    linked: 0,
    skipped: {},
  });
  assertEquals(h.calls.apply.length, 0);
  assertEquals(h.calls.insert, 0);
});

Deno.test("apply inserts the edition then links with the confirmed status", async () => {
  const h = harness();
  const code = await main(["--apply", "--hardcover-id", "325603"], h.deps);
  assertEquals(code, 0);
  assertEquals(h.calls.insert, 1);
  assertEquals(h.calls.apply, ["wikidata"]);
  assertEquals(last(h.lines).linked, 1);
});

Deno.test("search-document details failure skips the link", async () => {
  const h = harness({
    isSearchDocumentBook: () => true,
    hardcoverBooks: () => Promise.reject(new Error("down")),
  });
  const code = await main(["--apply", "--hardcover-id", "325603"], h.deps);
  assertEquals(code, 0);
  assert(h.lines.some((l) => l.includes('"details_failure"')));
  assertEquals(h.calls.apply.length, 0);
  assertEquals(last(h.lines).skipped, { details_failure: 1 });
});

Deno.test("wikidata author failure exits 3 without processing works", async () => {
  const h = harness({
    wikidataHebrewAuthors: () => Promise.reject(new Error("boom")),
  });
  const code = await main([], h.deps);
  assertEquals(code, 3);
  assertEquals(h.lines.map((l) => JSON.parse(l)), [{ error: "wikidata_authors" }]);
});

Deno.test("budget below the minimum at the 50-work check exits 4", async () => {
  const works = Array.from({ length: 60 }, (_, i) => work(1000 + i));
  const h = harness({ hardcoverDailyRemaining: () => Promise.resolve(10) }, works);
  const code = await main([], h.deps);
  assertEquals(code, 4);
  assertEquals(h.lines.length, 51);
  assertEquals(JSON.parse(h.lines[50]).stopped, "hardcover_budget");
});

Deno.test("rejected and failed candidates are skipped with a reason", async () => {
  const other: HardcoverBook = {
    id: 9,
    title: "Completely Different",
    cached_contributors: [{ author: { name: "Someone Else" } }],
  };
  const rejected = harness({
    resolveMatch: () =>
      Promise.resolve({
        found: { book: other, status: "fuzzy" },
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
  });
  assertEquals(await main(["--apply"], rejected.deps), 0);
  assertEquals(last(rejected.lines).skipped, { rejected: 1 });
  assertEquals(rejected.calls.apply.length, 0);

  const failedRun = harness({
    resolveMatch: () =>
      Promise.resolve({ found: null, failed: true }) as unknown as ReturnType<
        RunDeps["resolveMatch"]
      >,
  });
  assertEquals(await main([], failedRun.deps), 0);
  assertEquals(last(failedRun.lines).skipped, { provider_failure: 1 });
});

Deno.test("unknown argument prints usage and exits 2", async () => {
  const h = harness();
  assertEquals(await main(["--nope"], h.deps), 2);
  assert(h.errors[0].startsWith("Usage: rematch:cached"));
});
