import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

const HUNG = 1001;

const works = (n: number): RematchWork[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    hardcover_id: 1000 + i,
    original_title: `Title ${i}`,
    original_authors: ["Stephen King"],
  }));

function harness(count: number) {
  const lines: string[] = [];
  const timers: number[] = [];
  const hungCalls = { n: 0 };
  const book = (id: number): HardcoverBook => ({
    id,
    title: `Title ${id - 1000}`,
    cached_contributors: [{ author: { name: "Stephen King" } }],
  });
  const deps: Partial<RunDeps> = {
    // Fake clock: every deadline fires on the next macrotask.
    setTimer: (fn, ms) => {
      timers.push(ms);
      const id = setTimeout(fn, 0);
      return () => clearTimeout(id);
    },
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({
        end: () => Promise.resolve(),
      })) as unknown as RunDeps[
        "openProdDb"
      ],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () => Promise.resolve(works(count)),
    authorStore: () => memoryAuthorStore(),
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    loadEdition: () => Promise.resolve(null),
    wikidataHebrewAuthors: () => Promise.resolve(new Map()),
    wikidataOriginals: () => Promise.resolve(new Map()),
    nliOriginal: () => Promise.resolve(null),
    wiktionaryGlosses: () => Promise.resolve([]),
    hebrewHint: (b) => {
      if (b.id === HUNG) {
        hungCalls.n++;
        return new Promise(() => {});
      }
      return Promise.resolve({ title: `כותר ${b.id}` });
    },
    matchHebrewBook: (title) =>
      Promise.resolve({
        id: 3000 + Number(title.replace(/\D/g, "")),
        title,
      }),
    searchBooks: () => Promise.resolve([]),
    hebrewAuthorBySound: () => Promise.resolve(null),
    fetchEditionDetails: (id) =>
      Promise.resolve({ simania_id: id, title: "רזה", author: "סטיבן קינג" }),
    resolveMatch: (_db, edition) =>
      Promise.resolve({
        found: { book: book(edition.simania_id - 3000), status: "wikidata" },
        failed: false,
      } as unknown as Awaited<ReturnType<RunDeps["resolveMatch"]>>),
    log: (line) => lines.push(line),
    error: () => {},
  };
  return { deps, lines, timers, hungCalls };
}

Deno.test("a hung work ends as deadline provider_failure; others proceed", async () => {
  const h = harness(4);
  assertEquals(await main(["--work-timeout", "30"], h.deps), 0);
  assertEquals(h.timers.every((ms) => ms === 30000), true);
  const parsed = h.lines.map((l) => JSON.parse(l));
  const failure = parsed.find((p) => p.skipped === "provider_failure");
  assertEquals(failure.hardcover_id, HUNG);
  assertEquals(failure.failures[0].provider, "deadline");
  assertEquals(failure.failures[0].error.startsWith("30 s; pending: "), true);
  const ids = parsed.filter((p) => p.hardcover_id).map((p) => p.hardcover_id);
  assertEquals(ids, [...ids].sort((a, b) => a - b));
  assertEquals(ids.includes(1003), true);
  // Recheck: the hung work ran once more.
  assertEquals(h.hungCalls.n, 2);
  assertEquals(parsed[parsed.length - 1].rechecked, 1);
  assertEquals(parsed[parsed.length - 1].skipped.provider_failure, 1);
});

Deno.test("--concurrency 3 output is byte-identical to 1 with a hung work", async () => {
  const outputs: string[] = [];
  for (const c of ["1", "3"]) {
    const h = harness(6);
    assertEquals(
      await main(["--work-timeout", "30", "--concurrency", c], h.deps),
      0,
    );
    outputs.push(h.lines.join("\n"));
  }
  assertEquals(outputs[0], outputs[1]);
});

Deno.test("--work-timeout outside 30..3600 is rejected", async () => {
  for (const v of ["5", "29", "3601", "x", "30.5"]) {
    const h = harness(1);
    assertEquals(await main(["--work-timeout", v], h.deps), 2, v);
  }
});

Deno.test("a work that settles after its deadline neither writes nor prints", async () => {
  const h = harness(4);
  let release: (v: { title: string }) => void = () => {};
  h.deps.hebrewHint = (b) =>
    b.id === HUNG
      ? new Promise((resolve) => {
        release = resolve;
      })
      : Promise.resolve({ title: `כותר ${b.id}` });
  const writes: string[] = [];
  h.deps.insertEdition = (_sql, e) => {
    writes.push(`insert ${e.simania_id}`);
    return Promise.resolve();
  };
  h.deps.applyRepair = ((_sql: unknown, plan: { simania_id: number }) => {
    writes.push(`repair ${plan.simania_id}`);
    return Promise.resolve({ status: "linked" });
  }) as unknown as RunDeps["applyRepair"];
  h.deps.hardcoverBooks = (ids) =>
    Promise.resolve(ids.map((id) => ({
      id,
      title: `Title ${id - 1000}`,
      cached_contributors: [{ author: { name: "Stephen King" } }],
    })));
  assertEquals(await main(["--apply", "--work-timeout", "30"], h.deps), 0);
  const linesBefore = [...h.lines];
  const writesBefore = [...writes];
  // The hung provider call settles late (after both attempts timed out).
  release({ title: "כותר 1001" });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(writes, writesBefore);
  assertEquals(h.lines, linesBefore);
});

Deno.test("--hebrew editions run under the deadline too", async () => {
  const h = harness(1);
  const editions = [1, 2, 3].map((n) => ({
    simania_id: 3000 + n,
    title: "רזה",
    author: "סטיבן קינג",
  }));
  let hung = 0;
  h.deps.loadUnlinkedEditions =
    (() => Promise.resolve(editions)) as unknown as RunDeps[
      "loadUnlinkedEditions"
    ];
  const resolve = h.deps.resolveMatch!;
  h.deps.resolveMatch = ((db: never, edition: { simania_id: number }) => {
    if (edition.simania_id === 3002) {
      hung++;
      return new Promise(() => {});
    }
    return resolve(db, edition as never);
  }) as unknown as RunDeps["resolveMatch"];
  assertEquals(await main(["--hebrew", "--work-timeout", "30"], h.deps), 0);
  const parsed = h.lines.map((l) => JSON.parse(l));
  const failure = parsed.find((p) => p.skipped === "provider_failure");
  assertEquals(failure.simania_id, 3002);
  assertEquals(failure.failures[0].provider, "deadline");
  assertEquals(hung, 2);
  const order = parsed
    .map((p) => p.simania_id ?? p.proposal?.simania_id)
    .filter(Boolean);
  assertEquals(order, [3001, 3002, 3003]);
});

Deno.test("--work-timeout is rejected with --from", async () => {
  const h = harness(1);
  assertEquals(
    await main(["--from", "x.jsonl", "--work-timeout", "60"], h.deps),
    2,
  );
});

Deno.test("--hebrew: a timed-out edition that settles late does not print", async () => {
  const h = harness(1);
  const editions = [1, 2, 3].map((n) => ({
    simania_id: 3000 + n,
    title: "רזה",
    author: "סטיבן קינג",
  }));
  h.deps.loadUnlinkedEditions =
    (() => Promise.resolve(editions)) as unknown as RunDeps[
      "loadUnlinkedEditions"
    ];
  const resolve = h.deps.resolveMatch!;
  const late: (() => void)[] = [];
  let calls3002 = 0;
  h.deps.resolveMatch = ((db: never, edition: { simania_id: number }) => {
    if (edition.simania_id === 3001) {
      // Hangs on both attempts; settles only when released.
      return new Promise((r) =>
        late.push(() => r(resolve(db, edition as never)))
      );
    }
    if (edition.simania_id === 3002) {
      // During 3002's recheck, 3001's abandoned attempts settle.
      if (++calls3002 === 2) { for (const release of late) release(); }
      return new Promise(() => {});
    }
    return resolve(db, edition as never);
  }) as unknown as RunDeps["resolveMatch"];
  assertEquals(await main(["--hebrew", "--work-timeout", "30"], h.deps), 0);
  await new Promise((r) => setTimeout(r, 10));
  const parsed = h.lines.map((l) => JSON.parse(l));
  assertEquals(parsed.filter((p) => p.proposal?.simania_id === 3001), []);
  const order = parsed
    .map((p) => p.simania_id ?? p.proposal?.simania_id)
    .filter(Boolean);
  assertEquals(order, [3001, 3002, 3003]);
  assertEquals(parsed.at(-1).proposals, 1);
});
