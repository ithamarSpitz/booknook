import { assert, assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import {
  type CatalogProviders,
  resolveMatch,
} from "../../supabase/functions/_shared/catalog.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";

const edition = (simania_id: number, title: string): EditionRow => ({
  simania_id,
  work_id: null,
  resolve_status: "pending",
  resolved_at: null,
  title,
  author: "מחבר עברי",
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
});

function harness(options: {
  editions?: EditionRow[];
  providerOverrides?: Partial<CatalogProviders>;
} = {}) {
  const editions = options.editions ?? [
    edition(1, "כותר ללא תוצאה"),
    edition(2, "כותר חלש"),
  ];
  const lines: string[] = [];
  const errors: string[] = [];
  let detailsCalls = 0;
  const providerOverrides: Partial<CatalogProviders> = {
    wikidataOriginal: (title) =>
      Promise.resolve({
        title: title === "כותר ללא תוצאה" ? "Wanted Book" : "Weak Book",
        author: "Wanted Author",
        source: "Wikidata",
      }),
    nliOriginal: () => Promise.resolve(null),
    wikidataEnglishAuthor: () => Promise.resolve(null),
    findHardcoverBook: (title, _author, options) => {
      const weak = title === "Weak Book" || title === "כותר חלש";
      options?.trace?.({
        query: title,
        results: weak ? 1 : 0,
        best_title: weak ? "Different Book" : null,
        best_score: weak ? 0.2 : null,
      });
      return Promise.resolve(null);
    },
    ...options.providerOverrides,
  };
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({
        end: () => Promise.resolve(),
      })) as unknown as RunDeps["openProdDb"],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadUnlinkedEditions: () => Promise.resolve(editions),
    authorStore: () => memoryAuthorStore(),
    bookDetails: (id) => {
      detailsCalls++;
      return Promise.resolve({
        title: editions.find((row) => row.simania_id === id)?.title,
        translator: id === 1 ? "מתרגם א" : "מתרגמת ב",
      });
    },
    resolveMatch: (db, row, overrides) =>
      resolveMatch(db, row, { ...providerOverrides, ...overrides }),
    log: (message) => lines.push(message),
    error: (message) => errors.push(message),
  };
  return {
    deps,
    lines,
    errors,
    get detailsCalls() {
      return detailsCalls;
    },
  };
}

Deno.test("--hebrew --explain reports real resolver stops", async () => {
  const h = harness();
  assertEquals(await main(["--hebrew", "--explain"], h.deps), 0);
  assertEquals(h.detailsCalls, 2);
  assertEquals(JSON.parse(h.lines[0]), {
    simania_id: 1,
    skipped: "no_candidate",
    explain: {
      translator: "מתרגם א",
      original: { title: "Wanted Book", source: "Wikidata" },
      english_author: { name: "Wanted Author", source: "Wikidata" },
      hardcover_queries: [
        {
          query: "Wanted Book",
          results: 0,
          best_title: null,
          best_score: null,
        },
        {
          query: "כותר ללא תוצאה",
          results: 0,
          best_title: null,
          best_score: null,
        },
      ],
      stop: "no_hardcover_result",
    },
  });
  assertEquals(JSON.parse(h.lines[1]), {
    simania_id: 2,
    skipped: "no_candidate",
    explain: {
      translator: "מתרגמת ב",
      original: { title: "Weak Book", source: "Wikidata" },
      english_author: { name: "Wanted Author", source: "Wikidata" },
      hardcover_queries: [
        {
          query: "Weak Book",
          results: 1,
          best_title: "Different Book",
          best_score: 0.2,
        },
        {
          query: "כותר חלש",
          results: 1,
          best_title: "Different Book",
          best_score: 0.2,
        },
      ],
      stop: "title_below_threshold",
    },
  });
});

Deno.test("--hebrew --explain supplies a stop for a post-resolver skip", async () => {
  const h = harness({
    editions: [edition(3, "כותר תואם")],
    providerOverrides: {
      wikidataOriginal: () =>
        Promise.resolve({
          title: "Matched Book",
          author: "Wanted Author",
          source: "Wikidata",
        }),
      findHardcoverBook: () =>
        Promise.resolve({
          id: 99,
          title: "Matched Book",
          cached_contributors: [],
          cached_similar_book_ids: [],
        }),
    },
  });

  assertEquals(await main(["--hebrew", "--explain"], h.deps), 0);
  const line = JSON.parse(h.lines[0]);
  assertEquals(line.skipped, "author_mismatch");
  assertEquals(line.explain.stop, "author_mismatch");
});

Deno.test("--hebrew output is byte-identical without --explain", async () => {
  const h = harness();
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(h.detailsCalls, 0);
  assertEquals(
    h.lines.join("\n"),
    [
      '{"simania_id":1,"skipped":"no_candidate"}',
      '{"simania_id":2,"skipped":"no_candidate"}',
      '{"works":2,"proposals":0,"linked":0,"skipped":{"no_candidate":2}}',
    ].join("\n"),
  );
});

Deno.test("--explain requires --hebrew", async () => {
  const h = harness();
  assertEquals(await main(["--explain"], h.deps), 2);
  assert(h.errors[0].startsWith("Usage: rematch:cached"));
  assertEquals(h.lines, []);
});
