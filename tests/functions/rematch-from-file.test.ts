import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

const work: RematchWork = {
  id: "w1",
  hardcover_id: 325603,
  original_title: "Thinner",
  original_authors: ["Stephen King"],
};
const bookOf = (id: number): HardcoverBook => ({
  id,
  title: `Book ${id}`,
  cached_contributors: [],
});

const proposalLine = (simania_id: number, book_id: number) =>
  JSON.stringify({
    hardcover_id: 1,
    title: "t",
    proposal: { simania_id, book_id, hebrew_title: "רזה", via: "forward", status: "wikidata" },
  });

function harness(over: Partial<RunDeps> = {}, file = "") {
  const lines: string[] = [];
  const errors: string[] = [];
  const calls = {
    apply: [] as string[],
    insert: 0,
    sleeps: [] as number[],
    books: [] as number[][],
    forbidden: 0,
  };
  const forbidden = () => {
    calls.forbidden++;
    return Promise.reject(new Error("forbidden"));
  };
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
    insertEdition: () => {
      calls.insert++;
      return Promise.resolve();
    },
    wikidataHebrewAuthors: forbidden as unknown as RunDeps["wikidataHebrewAuthors"],
    wikidataOriginals: forbidden as unknown as RunDeps["wikidataOriginals"],
    nliOriginal: forbidden as unknown as RunDeps["nliOriginal"],
    hebrewHint: forbidden as unknown as RunDeps["hebrewHint"],
    matchHebrewBook: forbidden as unknown as RunDeps["matchHebrewBook"],
    searchBooks: forbidden as unknown as RunDeps["searchBooks"],
    resolveMatch: forbidden as unknown as RunDeps["resolveMatch"],
    fetchEditionDetails: (id) =>
      Promise.resolve({ simania_id: id, title: "רזה", author: "סטיבן קינג" }),
    applyRepair: (_sql, plan, _now, status) => {
      calls.apply.push(status);
      return Promise.resolve({
        simania_id: plan.simania_id,
        status: "linked" as const,
        work_id: "w",
      });
    },
    hardcoverBooks: (ids) => {
      calls.books.push(ids);
      return Promise.resolve(ids.map(bookOf));
    },
    readTextFile: () => Promise.resolve(file),
    sleep: (ms) => {
      calls.sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => new Date(0),
    log: (m) => lines.push(m),
    error: (m) => errors.push(m),
    ...over,
  };
  return { deps, lines, errors, calls };
}

const last = (lines: string[]) => JSON.parse(lines[lines.length - 1]);

Deno.test("wikidata authors: two failures then success sleeps twice", async () => {
  let n = 0;
  const h = harness({
    wikidataHebrewAuthors: () =>
      ++n <= 2 ? Promise.reject(new Error("x")) : Promise.resolve(new Map()),
    findCandidates: undefined,
  } as Partial<RunDeps>);
  const code = await main([], h.deps);
  assertEquals(code, 0);
  assertEquals(h.calls.sleeps, [30000, 30000]);
  assertEquals(n, 3);
});

Deno.test("wikidata authors: three failures exit 3", async () => {
  let n = 0;
  const h = harness({
    wikidataHebrewAuthors: () => {
      n++;
      return Promise.reject(new Error("x"));
    },
  });
  assertEquals(await main([], h.deps), 3);
  assertEquals(n, 3);
  assertEquals(last(h.lines), { error: "wikidata_authors" });
});

Deno.test("--from applies one proposal and ignores other lines", async () => {
  const file = [
    proposalLine(3191, 77),
    JSON.stringify({ hardcover_id: 2, title: "u", skipped: "rejected" }),
    "not json",
  ].join("\n");
  const h = harness({}, file);
  const code = await main(["--from", "x.jsonl", "--apply"], h.deps);
  assertEquals(code, 0);
  assertEquals(h.calls.books, [[77]]);
  assertEquals(h.calls.apply, ["wikidata"]);
  assertEquals(h.calls.insert, 1);
  assertEquals(h.calls.forbidden, 0);
  assertEquals(JSON.parse(h.lines[0]), {
    simania_id: 3191,
    book_id: 77,
    hebrew_title: "רזה",
    action: "link",
  });
  assertEquals(last(h.lines), { proposals: 1, linked: 1, skipped: {} });
});

Deno.test("--from fetches Hardcover books in chunks of 50", async () => {
  const file = Array.from({ length: 120 }, (_, i) => proposalLine(1000 + i, 5000 + i))
    .join("\n");
  const h = harness({}, file);
  assertEquals(await main(["--from", "x"], h.deps), 0);
  assertEquals(h.calls.books.map((c) => c.length), [50, 50, 20]);
  assertEquals(last(h.lines).proposals, 120);
});

Deno.test("--from skips an edition linked elsewhere", async () => {
  const h = harness({
    loadEdition: () =>
      Promise.resolve({ simania_id: 3191, work_id: "other" } as never),
  }, proposalLine(3191, 77));
  assertEquals(await main(["--from", "x", "--apply"], h.deps), 0);
  assertEquals(h.calls.apply.length, 0);
  assertEquals(last(h.lines).skipped, { linked_elsewhere: 1 });
});

Deno.test("--from marks a book missing from the answer as details_failure", async () => {
  const h = harness({ hardcoverBooks: () => Promise.resolve([]) }, proposalLine(3191, 77));
  assertEquals(await main(["--from", "x", "--apply"], h.deps), 0);
  assertEquals(h.calls.apply.length, 0);
  assertEquals(last(h.lines).skipped, { details_failure: 1 });
});

Deno.test("--from marks a thrown chunk as details_failure", async () => {
  const h = harness(
    { hardcoverBooks: () => Promise.reject(new Error("down")) },
    proposalLine(3191, 77),
  );
  assertEquals(await main(["--from", "x", "--apply"], h.deps), 0);
  assertEquals(last(h.lines).skipped, { details_failure: 1 });
});

Deno.test("--from without --apply only reports would_link", async () => {
  const h = harness({}, proposalLine(3191, 77));
  assertEquals(await main(["--from", "x"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).action, "would_link");
  assertEquals(h.calls.insert, 0);
  assertEquals(h.calls.apply.length, 0);
});

Deno.test("--from with --limit is a usage error", async () => {
  const h = harness();
  assertEquals(await main(["--from", "x", "--limit", "5"], h.deps), 2);
  assertEquals(await main(["--from"], h.deps), 2);
});
