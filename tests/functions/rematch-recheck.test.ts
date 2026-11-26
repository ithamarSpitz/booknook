import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

const mkWork = (id: number, title = "Catching Fire"): RematchWork => ({
  id: `w${id}`,
  hardcover_id: id,
  original_title: title,
  original_authors: ["Suzanne Collins"],
});
const bookOf = (id: number, title = "Catching Fire"): HardcoverBook => ({
  id,
  title,
  cached_contributors: [{ author: { name: "Suzanne Collins" } }],
});

type Resolve = (id: number, call: number) => "fail" | "reject" | "ok";

function harness(
  works: RematchWork[],
  over: Partial<RunDeps> = {},
  resolve: Resolve = () => "reject",
) {
  const lines: string[] = [];
  const calls = new Map<number, number>();
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({ end: () => Promise.resolve() })) as unknown as RunDeps[
        "openProdDb"
      ],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () => Promise.resolve(works),
    authorStore: () => memoryAuthorStore(),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    loadEdition: () => Promise.resolve(null),
    loadLinkedWork: () => Promise.resolve(null),
    insertEdition: () => Promise.resolve(),
    wikidataHebrewAuthors: () =>
      Promise.resolve(new Map([["Suzanne Collins", ["סוזן קולינס"]]])),
    wikidataOriginals: () => Promise.resolve(new Map()),
    nliOriginal: (_title, _author) => Promise.resolve({ title: "Catching Fire" }),
    wiktionaryGlosses: () => Promise.resolve([]),
    // The forward hint is the only candidate; the resolver rejects it.
    hebrewHint: () =>
      Promise.resolve({ title: "התלקחות", author: "סוזן קולינס" }),
    matchHebrewBook: () => Promise.resolve({ id: 101 }),
    searchBooks: () =>
      Promise.resolve([{ id: 101, title: "התלקחות", author: "סוזן קולינס" }]),
    hebrewAuthorBySound: () => Promise.resolve(null),
    resolveMatch: (_db, edition) => {
      void edition;
      return Promise.resolve({ found: null, failed: false, failures: [] });
    },
    fetchEditionDetails: (id) =>
      Promise.resolve({ simania_id: id, title: "התלקחות", author: "סוזן קולינס" }),
    hardcoverBooks: (ids) => Promise.resolve(ids.map((i) => bookOf(i))),
    sleep: () => Promise.resolve(),
    now: () => new Date(0),
    log: (m) => lines.push(m),
    error: () => {},
    ...over,
  };
  void resolve;
  void calls;
  return { deps, lines };
}

const last = (lines: string[]) => JSON.parse(lines.at(-1)!);

Deno.test("a rejected only-candidate still gets the author_books check", async () => {
  const h = harness([mkWork(175780)]);
  assertEquals(await main([], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).proposal, {
    simania_id: 101,
    book_id: 175780,
    hebrew_title: "התלקחות",
    via: "author_books",
    status: "nli",
  });
});

Deno.test("author_books proposal still needs author agreement", async () => {
  const h = harness([mkWork(1)], {
    fetchEditionDetails: (id) =>
      Promise.resolve({ simania_id: id, title: "התלקחות", author: "דן בראון" }),
  });
  await main([], h.deps);
  assertEquals(JSON.parse(h.lines[0]).skipped, "author_mismatch");
});

const linkedDeps = (other: {
  hardcover_id: number;
  original_title: string;
  original_authors: string[];
} | null): Partial<RunDeps> => ({
  loadEdition: () =>
    Promise.resolve({ simania_id: 101, work_id: "other" } as never),
  loadLinkedWork: () => Promise.resolve(other),
});

Deno.test("a duplicate work is named on linked_elsewhere", async () => {
  const h = harness([mkWork(1)], linkedDeps({
    hardcover_id: 2,
    original_title: "catching  fire",
    original_authors: ["Suzanne Collins"],
  }));
  await main([], h.deps);
  assertEquals(JSON.parse(h.lines[0]).skipped, "linked_elsewhere");
  assertEquals(JSON.parse(h.lines[0]).duplicate_of, 2);
});

Deno.test("a different linked work gives no duplicate_of", async () => {
  for (
    const other of [
      { hardcover_id: 2, original_title: "Mockingjay", original_authors: ["Suzanne Collins"] },
      { hardcover_id: 3, original_title: "Catching Fire", original_authors: ["Someone Else"] },
      null,
    ]
  ) {
    const h = harness([mkWork(1)], linkedDeps(other));
    await main([], h.deps);
    assertEquals(JSON.parse(h.lines[0]).skipped, "linked_elsewhere");
    assertEquals("duplicate_of" in JSON.parse(h.lines[0]), false);
  }
});

function flaky(failFirstFor: number[]) {
  const seen = new Map<number, number>();
  const ok = new Set<number>();
  return {
    resolveMatch: ((_db: unknown, edition: { simania_id: number }) => {
      // The work id travels through the edition only by call order, so key on
      // the hint call below instead.
      void edition;
      return Promise.resolve({ found: null, failed: false, failures: [] });
    }) as unknown as RunDeps["resolveMatch"],
    hebrewHint: ((work: { id: number }) => {
      const n = (seen.get(work.id) ?? 0) + 1;
      seen.set(work.id, n);
      if (failFirstFor.includes(work.id) && n === 1) {
        return Promise.reject(new Error("down"));
      }
      ok.add(work.id);
      return Promise.resolve({ title: "התלקחות", author: "סוזן קולינס" });
    }) as unknown as RunDeps["hebrewHint"],
  };
}

Deno.test("a work that fails first and succeeds on recheck ends with its outcome", async () => {
  const h = harness([mkWork(1), mkWork(2), mkWork(3)], flaky([2]));
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.lines.length, 4);
  assertEquals(JSON.parse(h.lines[1]).hardcover_id, 2);
  assertEquals(JSON.parse(h.lines[1]).proposal.via, "author_books");
  assertEquals(last(h.lines), {
    works: 3,
    proposals: 3,
    linked: 0,
    skipped: {},
    rechecked: 1,
  });
});

Deno.test("a work that fails twice stays provider_failure and is counted once", async () => {
  const h = harness([mkWork(1)], {
    hebrewHint: () => Promise.reject(new Error("down")),
  });
  await main([], h.deps);
  assertEquals(JSON.parse(h.lines[0]).skipped, "provider_failure");
  assertEquals(last(h.lines).skipped, { provider_failure: 1 });
  assertEquals(last(h.lines).rechecked, 1);
});

Deno.test("--concurrency 3 output is byte-identical to --concurrency 1 with a recheck", async () => {
  const works = Array.from({ length: 8 }, (_, i) => mkWork(i + 1));
  const run = async (concurrency: string) => {
    const h = harness(works, flaky([2, 5]));
    assertEquals(await main(["--concurrency", concurrency], h.deps), 0);
    return h.lines.join("\n");
  };
  const one = await run("1");
  assertEquals(await run("3"), one);
  assertEquals(one.includes('"rechecked":2'), true);
});
