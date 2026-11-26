import { assert, assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";

const kingBook: HardcoverBook = {
  id: 325603,
  title: "Thinner",
  cached_contributors: [{ author: { name: "Stephen King" } }],
};

const edition = (
  simania_id: number,
  author = "סטיבן קינג",
): EditionRow => ({
  simania_id,
  work_id: null,
  resolve_status: "pending",
  resolved_at: null,
  title: "רזה",
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

function harness(
  editions: EditionRow[],
  over: Partial<RunDeps> = {},
) {
  const lines: string[] = [];
  const errors: string[] = [];
  let applyCalls = 0;
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
    nliOriginal: () => Promise.resolve(null),
    resolveMatch: () =>
      Promise.resolve({
        found: { book: kingBook, status: "wikidata" },
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
    applyRepair: () => {
      applyCalls++;
      return Promise.reject(new Error("must not apply"));
    },
    log: (message) => lines.push(message),
    error: (message) => errors.push(message),
    ...over,
  };
  return {
    deps,
    lines,
    errors,
    get applyCalls() {
      return applyCalls;
    },
  };
}

Deno.test("--hebrew proposes an agreeing resolved edition without linking", async () => {
  const h = harness([edition(3191)]);
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]), {
    hardcover_id: 325603,
    title: "Thinner",
    proposal: {
      simania_id: 3191,
      book_id: 325603,
      hebrew_title: "רזה",
      via: "hebrew",
      status: "wikidata",
    },
  });
  assertEquals(h.applyCalls, 0);
});

Deno.test("--hebrew skips an NLI English mismatch", async () => {
  const h = harness([edition(3191)], {
    nliOriginal: () => Promise.resolve({ title: "Battle of Corrin" }),
    resolveMatch: () =>
      Promise.resolve({
        found: {
          book: { ...kingBook, title: "Dune: The Graphic Novel, Book 1" },
          status: "wikidata",
        },
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
  });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]), {
    simania_id: 3191,
    skipped: "nli_english_mismatch",
  });
  assertEquals(JSON.parse(h.lines.at(-1)!).proposals, 0);
});

Deno.test("--hebrew skips a resolved edition whose author disagrees", async () => {
  const princeHarry: HardcoverBook = {
    id: 1,
    title: "Spare",
    cached_contributors: [{ author: { name: "Prince Harry" } }],
  };
  const h = harness([edition(7, "Dan O'Sullivan")], {
    resolveMatch: () =>
      Promise.resolve({
        found: { book: princeHarry, status: "nli" },
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
  });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]), {
    simania_id: 7,
    skipped: "author_mismatch",
  });
  assertEquals(JSON.parse(h.lines.at(-1)!).proposals, 0);
});

Deno.test("--hebrew continues after a resolver provider failure", async () => {
  const h = harness([edition(1), edition(2)], {
    resolveMatch: (_db, e) =>
      Promise.resolve(
        e.simania_id === 1 ? { found: null, failed: true } : {
          found: { book: kingBook, status: "fuzzy" as const },
          failed: false,
        },
      ) as unknown as ReturnType<RunDeps["resolveMatch"]>,
  });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).skipped, "provider_failure");
  assertEquals(JSON.parse(h.lines[1]).proposal.simania_id, 2);
  assertEquals(JSON.parse(h.lines.at(-1)!), {
    works: 2,
    proposals: 1,
    linked: 0,
    skipped: { provider_failure: 1 },
    rechecked: 1,
  });
});

Deno.test("--hebrew cannot be combined with --apply", async () => {
  const h = harness([]);
  assertEquals(await main(["--hebrew", "--apply"], h.deps), 2);
  assert(h.errors[0].includes("[--hebrew]"));
});

Deno.test("a --hebrew proposal round trips through dry --from", async () => {
  const first = harness([edition(3191)]);
  assertEquals(await main(["--hebrew"], first.deps), 0);

  const second = harness([], {
    readTextFile: () => Promise.resolve(first.lines.join("\n")),
    hardcoverBooks: () => Promise.resolve([kingBook]),
    loadEdition: () => Promise.resolve(edition(3191)),
  });
  assertEquals(await main(["--from", "proposals.jsonl"], second.deps), 0);
  assert(second.lines.some((line) => {
    const value = JSON.parse(line);
    return value.simania_id === 3191 && value.action === "would_link";
  }));
  assertEquals(second.applyCalls, 0);
});
