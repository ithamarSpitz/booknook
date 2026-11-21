import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import type { AuthorStore } from "../../supabase/functions/_shared/authors.ts";

const work = (
  hardcover_id: number,
  author: string,
): RematchWork => ({
  id: `w${hardcover_id}`,
  hardcover_id,
  original_title: `Book ${hardcover_id}`,
  original_authors: [author],
});

function harness(
  works: RematchWork[],
  over: Partial<RunDeps> = {},
  store = memoryAuthorStore(),
) {
  const lines: string[] = [];
  const queries: string[] = [];
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({
        end: () => Promise.resolve(),
      })) as unknown as RunDeps["openProdDb"],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadWorks: () => Promise.resolve(works),
    authorStore: () => store,
    loadLinkedSimaniaIds: () => Promise.resolve(new Set<number>()),
    wikidataHebrewAuthors: () => Promise.resolve(new Map()),
    wikidataOriginals: () => Promise.resolve(new Map()),
    nliOriginal: () => Promise.resolve(null),
    wiktionaryGlosses: () => Promise.resolve([]),
    hebrewHint: () => Promise.resolve(null),
    searchBooks: (query) => {
      queries.push(query);
      return Promise.resolve([]);
    },
    now: () => new Date(0),
    sleep: () => Promise.resolve(),
    log: (message) => lines.push(message),
    error: () => {},
    ...over,
  };
  return { deps, lines, queries };
}

Deno.test("rematch uses a sound name when stored and Wikidata names are empty", async () => {
  const calls: string[] = [];
  const readable = memoryAuthorStore();
  const rejectWrite = () => Promise.reject(new Error("read-only store write"));
  const store: AuthorStore = {
    ...readable,
    create: rejectWrite,
    addNames: rejectWrite,
    merge: rejectWrite,
    markWikidataChecked: rejectWrite,
    markSoundChecked: rejectWrite,
  };
  const h = harness([work(1, "Julia Walton")], {
    hebrewAuthorBySound: (name) => {
      calls.push(name);
      return Promise.resolve("ג'וליה וולטון");
    },
  }, store);

  assertEquals(await main([], h.deps), 0);
  assertEquals(calls, ["Julia Walton"]);
  assertEquals(h.queries, ["ג'וליה וולטון"]);
});

Deno.test("rematch does not use sound lookup when a stored name exists", async () => {
  const store = memoryAuthorStore();
  const authorId = await store.create();
  await store.addNames(authorId, [
    { lang: "en", name: "Julia Walton", source: "link" },
    { lang: "he", name: "ג'וליה וולטון", source: "link" },
  ]);
  let calls = 0;
  const h = harness([work(1, "Julia Walton")], {
    hebrewAuthorBySound: () => {
      calls++;
      return Promise.resolve(null);
    },
  }, store);

  assertEquals(await main([], h.deps), 0);
  assertEquals(calls, 0);
  assertEquals(h.queries, ["ג'וליה וולטון"]);
});

Deno.test("a throwing sound lookup skips one work and continues", async () => {
  const h = harness([
    work(1, "Broken Author"),
    work(2, "Julia Walton"),
  ], {
    hebrewAuthorBySound: (name) => {
      if (name === "Broken Author") return Promise.reject(new Error("down"));
      return Promise.resolve("ג'וליה וולטון");
    },
  });

  assertEquals(await main([], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).skipped, "provider_failure");
  assertEquals(JSON.parse(h.lines[1]).hardcover_id, 2);
  assertEquals(h.queries, ["ג'וליה וולטון"]);
  assertEquals(JSON.parse(h.lines.at(-1)!).skipped, {
    provider_failure: 1,
    no_candidate: 1,
  });
});
