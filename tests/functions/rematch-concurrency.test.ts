import { assertEquals } from "jsr:@std/assert@1";
import { main, type RunDeps } from "../../scripts/rematch-cached.ts";
import { memoryAuthorStore } from "../../scripts/lib/link-proposal.ts";
import type { RematchWork } from "../../scripts/lib/rematch.ts";
import { throttledProviderFetch } from "../../scripts/lib/provider-throttle.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

const FAILING = 5;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const works = (n: number): RematchWork[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    hardcover_id: 1000 + i,
    original_title: `Title ${i}`,
    original_authors: [i % 2 ? "Stephen King" : "Agatha Christie"],
  }));

const HOSTS: Record<string, string> = {
  hardcover: "https://api.hardcover.app/v1/graphql",
  simania: "https://simania.co.il/api/mcp",
  nli: "https://nli.alma.exlibrisgroup.com/view/sru/972",
  wikimedia: "https://www.wikidata.org/w/api.php",
};

function harness(count: number, over: Partial<RunDeps> = {}) {
  const lines: string[] = [];
  const random = rng(42);
  const inFlight: Record<string, number> = {};
  let overlap = false;
  const stub = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const group = Object.keys(HOSTS).find((k) => url === HOSTS[k])!;
    inFlight[group] = (inFlight[group] ?? 0) + 1;
    if (inFlight[group] > 1) overlap = true;
    await new Promise((r) => setTimeout(r, Math.floor(random() * 6)));
    inFlight[group]--;
    return new Response("{}");
  }) as typeof fetch;
  const limited = throttledProviderFetch(
    stub,
    () => new Promise((r) => setTimeout(r, 0)),
    () => 0,
  );
  const call = async (group: string) => {
    await limited(HOSTS[group]);
  };
  const book = (id: number): HardcoverBook => ({
    id,
    title: `Title ${id - 1000}`,
    cached_contributors: [{ author: { name: "Stephen King" } }],
  });
  const deps: Partial<RunDeps> = {
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
    wikidataOriginals: async () => {
      await call("wikimedia");
      return new Map();
    },
    nliOriginal: async () => {
      await call("nli");
      return null;
    },
    wiktionaryGlosses: () => Promise.resolve([]),
    hebrewHint: async (b) => {
      await call("hardcover");
      return { title: `כותר ${b.id}` };
    },
    matchHebrewBook: async (title) => {
      await call("simania");
      return { id: 3000 + Number(title.replace(/\D/g, "")), title };
    },
    searchBooks: async () => {
      await call("simania");
      return [];
    },
    hebrewAuthorBySound: () => Promise.resolve(null),
    fetchEditionDetails: async (id) => {
      await call("simania");
      return { simania_id: id, title: "רזה", author: "סטיבן קינג" };
    },
    resolveMatch: async (_db, edition) => {
      await call("wikimedia");
      if (edition.simania_id === 3000 + 1000 + FAILING) {
        return {
          found: null,
          failed: true,
          failures: [{ provider: "wikidata", error: "boom" }],
        } as unknown as Awaited<ReturnType<RunDeps["resolveMatch"]>>;
      }
      return {
        found: { book: book(edition.simania_id - 3000), status: "wikidata" },
        failed: false,
      } as unknown as Awaited<ReturnType<RunDeps["resolveMatch"]>>;
    },
    log: (line) => lines.push(line),
    error: () => {},
    ...over,
  };
  return { deps, lines, overlapped: () => overlap };
}

Deno.test("--concurrency 3 prints byte-identical output to 1", async () => {
  const outputs: string[] = [];
  for (const c of ["1", "3"]) {
    const h = harness(12);
    assertEquals(await main(["--concurrency", c], h.deps), 0);
    assertEquals(h.overlapped(), false);
    outputs.push(h.lines.join("\n"));
  }
  assertEquals(outputs[0], outputs[1]);
  const parsed = outputs[0].split("\n").map((l) => JSON.parse(l));
  assertEquals(parsed.length > 12, true);
  assertEquals(
    parsed.some((p) =>
      p.skipped === "provider_failure" &&
      JSON.stringify(p.failures) ===
        '[{"provider":"wikidata","error":"boom"}]'
    ),
    true,
  );
});

Deno.test("never two requests in flight to one host group", async () => {
  const h = harness(12);
  assertEquals(await main(["--concurrency", "4"], h.deps), 0);
  assertEquals(h.overlapped(), false);
});

Deno.test("budget floor stops new works with exit 4", async () => {
  const h = harness(80, {
    hardcoverDailyRemaining: () => Promise.resolve(10),
  });
  assertEquals(await main(["--concurrency", "3"], h.deps), 4);
  const last = JSON.parse(h.lines[h.lines.length - 1]);
  assertEquals(last.stopped, "hardcover_budget");
  assertEquals(last.works >= 50 && last.works < 80, true);
});

Deno.test("invalid --concurrency usages are rejected", async () => {
  for (
    const args of [
      ["--concurrency", "5"],
      ["--concurrency", "0"],
      ["--concurrency", "x"],
      ["--concurrency", "2", "--hebrew"],
      ["--concurrency", "2", "--from", "x.json"],
      ["--concurrency", "2", "--hardcover-id", "7"],
    ]
  ) {
    const h = harness(1);
    assertEquals(await main(args, h.deps), 2, args.join(" "));
  }
});
