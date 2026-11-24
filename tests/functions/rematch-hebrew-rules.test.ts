import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";

const book: HardcoverBook = {
  id: 10,
  title: "Dune Graphic Novel Book",
  cached_contributors: [{ author: { name: "Stephen King" } }],
};

const edition: EditionRow = {
  simania_id: 7,
  work_id: null,
  resolve_status: "pending",
  resolved_at: null,
  title: "רזה",
  author: "סטיבן קינג",
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
};

function harness(options: { found: boolean; original?: string }) {
  const lines: string[] = [];
  let dictionaryCalls = 0;
  let hardcoverCalls = 0;
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
        found: options.found ? { book, status: "wikidata" as const } : null,
        failed: false,
      }) as unknown as ReturnType<RunDeps["resolveMatch"]>,
    wiktionaryGlosses: () => {
      dictionaryCalls++;
      return Promise.resolve(["thin"]);
    },
    findHardcoverBook: () => {
      hardcoverCalls++;
      return Promise.resolve(book);
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
    hardcoverCalls: () => hardcoverCalls,
  };
}

Deno.test("--hebrew keeps the nli_english_mismatch guard", async () => {
  const h = harness({ found: true, original: "Battle of Corrin" });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).skipped, "nli_english_mismatch");
});

Deno.test("--hebrew never uses the dictionary or emits hebrew_dictionary", async () => {
  const h = harness({ found: false });
  assertEquals(await main(["--hebrew"], h.deps), 0);
  assertEquals(JSON.parse(h.lines[0]).skipped, "no_candidate");
  assertEquals(h.dictionaryCalls(), 0);
  assertEquals(h.hardcoverCalls(), 0);
  assertEquals(h.lines.some((l) => l.includes("hebrew_dictionary")), false);
});
