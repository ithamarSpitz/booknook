import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import {
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";

const thin: HardcoverBook = {
  id: 42,
  title: "Thin",
  cached_contributors: [{ author: { name: "Stephen King" } }],
};

const row = (author = "סטיבן קינג", title = "רזה"): EditionRow => ({
  simania_id: 7,
  work_id: null,
  resolve_status: "pending",
  resolved_at: null,
  title,
  author,
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
  edition?: EditionRow;
  book?: HardcoverBook;
  resolved?: HardcoverBook | null;
  original?: string | null;
  glosses?: (word: string) => string[];
} = {}) {
  const lines: string[] = [];
  let dictionaryCalls = 0;
  const hardcoverCalls: unknown[][] = [];
  const edition = options.edition ?? row();
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: (() => ({})) as unknown as RunDeps["loadOperatorEnv"],
    openProdDb: (() =>
      Promise.resolve({
        end: () => Promise.resolve(),
      })) as unknown as RunDeps["openProdDb"],
    checkHardcoverBudget: () => Promise.resolve(true),
    hardcoverDailyRemaining: () => Promise.resolve(5000),
    loadUnlinkedEditions: () => Promise.resolve([edition]),
    authorStore: () => memoryAuthorStore(),
    resolveMatch: () =>
      Promise.resolve({
        found: options.resolved
          ? { book: options.resolved, status: "wikidata" as const }
          : null,
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
    wiktionaryGlosses: (word) => {
      dictionaryCalls++;
      return Promise.resolve(
        options.glosses?.(word) ?? [options.book?.title ?? thin.title],
      );
    },
    findHardcoverBook: (title, author, searchOptions) => {
      hardcoverCalls.push([title, author, searchOptions]);
      return Promise.resolve(options.book ?? thin);
    },
    nliOriginal: () =>
      Promise.resolve(options.original ? { title: options.original } : null),
    log: (line) => lines.push(line),
    error: () => undefined,
  };
  return {
    deps,
    lines,
    dictionaryCalls: () => dictionaryCalls,
    hardcoverCalls,
  };
}

Deno.test("--hebrew proposes an agreeing dictionary Hardcover match", async () => {
  const h = harness();
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).proposal, {
    simania_id: 7,
    book_id: 42,
    hebrew_title: "רזה",
    via: "hebrew_dictionary",
    status: "fuzzy",
  });
  assertEquals(h.hardcoverCalls, [["Thin", "", {
    requireAuthor: true,
    retryWithAuthor: true,
    soundAuthor: "סטיבן קינג",
  }]]);
});

Deno.test("--hebrew rejects a dictionary match whose author disagrees", async () => {
  const h = harness({
    book: {
      id: 9,
      title: "Thin",
      cached_contributors: [{ author: { name: "Prince Harry" } }],
    },
  });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).skipped, "author_mismatch");
});

Deno.test("--hebrew applies the NLI mismatch guard to a dictionary match", async () => {
  const book: HardcoverBook = {
    id: 10,
    title: "Dune Graphic Novel Book",
    cached_contributors: [{ author: { name: "Stephen King" } }],
  };
  const h = harness({ book, original: "Battle of Corrin" });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).skipped, "nli_english_mismatch");
});

Deno.test("--hebrew does not call the dictionary after resolveMatch succeeds", async () => {
  const h = harness({ resolved: thin });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).proposal.via, "hebrew");
  assertEquals(h.dictionaryCalls(), 0);
  assertEquals(h.hardcoverCalls, []);
});

for (const agrees of [true, false]) {
  Deno.test(`--hebrew real Hardcover matcher: author agrees = ${agrees}`, async () => {
    const originalFetch = globalThis.fetch;
    const token = Deno.env.get("HARDCOVER_API_KEY");
    Deno.env.set("HARDCOVER_API_KEY", "fake");
    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(Response.json({
        data: {
          search: {
            ids: ["42"],
            results: {
              hits: [{
                document: {
                  id: "42",
                  title: "Thin",
                  contributions: [{
                    author: {
                      name: agrees ? "Stephen King" : "Prince Harry",
                    },
                  }],
                },
              }],
            },
          },
        },
      }));
    };
    try {
      const h = harness();
      h.deps.findHardcoverBook = findHardcoverBook;
      assertEquals(await main(["--hebrew"], h.deps), 0);
      assertEquals(calls, 1);
      const result = JSON.parse(h.lines[0]);
      if (agrees) assertEquals(result.proposal.via, "hebrew_dictionary");
      else assertEquals(result.skipped, "no_candidate");
    } finally {
      globalThis.fetch = originalFetch;
      if (token === undefined) Deno.env.delete("HARDCOVER_API_KEY");
      else Deno.env.set("HARDCOVER_API_KEY", token);
    }
  });
}

for (
  const [label, title, english, glosses] of [
    ["English coverage", "רזה", "Thin Moon River", () => ["thin"]],
    [
      "Hebrew coverage",
      "רזה ירח נהר",
      "Thin",
      (word: string) => word === "רזה" ? ["thin"] : [],
    ],
    [
      "contradiction despite sufficient coverage",
      "רזה ירח נהר כוכב",
      "Thin Moon River",
      (word: string) => ({
        "רזה": ["thin"],
        "ירח": ["moon"],
        "נהר": ["river"],
        "כוכב": ["star"],
      }[word] ?? []),
    ],
  ] as const
) {
  Deno.test(`--hebrew dictionary rejects ${label}`, async () => {
    const h = harness({
      edition: row(undefined, title),
      book: { ...thin, title: english },
      glosses,
    });
    assertEquals(await main(["--hebrew"], h.deps), 0);
    assertEquals(JSON.parse(h.lines[0]).skipped, "no_candidate");
  });
}
