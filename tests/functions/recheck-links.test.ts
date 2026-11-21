import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import type { Sql } from "npm:postgres@3.4.5";
import { main, type RunDeps } from "../../scripts/recheck-links.ts";
import { findHardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

interface Query {
  text: string;
  values: unknown[];
}

const RELINK = {
  simania_id: 16301,
  title: "המורד",
  author: "אלבר קאמי",
  resolve_status: "wikidata",
  work_id: "work-old",
  work_hardcover_id: 1851773,
  work_original_title: "The Rebel Old",
};
const SAME = {
  ...RELINK,
  simania_id: 2,
  work_id: "work-same",
  work_hardcover_id: 5,
};
const BOX = {
  ...RELINK,
  simania_id: 3,
  title: "טרילוגיית X",
  work_id: "work-box",
  work_hardcover_id: 7,
  resolve_status: "fuzzy",
};

function fakeSql(rows: Record<string, unknown>[], updateRows = 1) {
  const queries: Query[] = [];
  let ended = 0;
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    queries.push({ text, values });
    if (/^\s*update/i.test(text)) {
      return Promise.resolve(
        Array.from({ length: updateRows }, () => ({ simania_id: 1 })),
      );
    }
    return Promise.resolve(rows);
  }) as unknown as Sql;
  (sql as unknown as { end: () => Promise<void> }).end = () => {
    ended++;
    return Promise.resolve();
  };
  return { sql, queries, ended: () => ended };
}

type Match = Awaited<ReturnType<RunDeps["resolveMatch"]>>;

function harness(
  fake: ReturnType<typeof fakeSql>,
  matches: Record<number, Match>,
) {
  const logs: string[] = [];
  const errors: string[] = [];
  const opens: unknown[] = [];
  const resolved: number[] = [];
  const sleeps: number[] = [];
  const repairs: { plan: unknown; status: unknown }[] = [];
  const deps: Partial<RunDeps> = {
    loadOperatorEnv: () => ({ dbPassword: "x" }),
    openProdDb: (options) => {
      opens.push(options);
      return Promise.resolve(fake.sql);
    },
    resolveMatch: (_db, edition) => {
      resolved.push(edition.simania_id);
      return Promise.resolve(matches[edition.simania_id]);
    },
    applyRepair: (_sql, plan, _now, status) => {
      repairs.push({ plan, status });
      return Promise.resolve({
        simania_id: plan.simania_id,
        status: "linked",
        work_id: "new",
      });
    },
    hardcoverBooks: () => Promise.reject(new Error("unexpected hardcoverBooks")),
    checkHardcoverBudget: () => Promise.resolve(true),
    now: () => new Date("2026-11-21T00:00:00Z"),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
  };
  return { deps, logs, errors, opens, resolved, repairs, sleeps };
}

const rebel: Match = {
  found: {
    book: { id: 488917, title: "The Rebel" } as never,
    status: "wikidata",
  },
  failed: false,
};

Deno.test("dry run prints a relink and the summary, read-only, no write", async () => {
  const fake = fakeSql([RELINK]);
  const h = harness(fake, { 16301: rebel });
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.opens, [{ readOnly: true }]);
  assert(!fake.queries.some((q) => /\b(update|insert) /i.test(q.text)));
  assertEquals(h.repairs.length, 0);
  assertEquals(h.logs.length, 2);
  const line = JSON.parse(h.logs[0]);
  assertEquals(line.action, "relink");
  assertEquals(line.from.hardcover_id, 1851773);
  assertEquals(line.to, { hardcover_id: 488917, title: "The Rebel" });
  assertEquals(line.status, "wikidata");
  assertEquals(JSON.parse(h.logs[1]), { checked: 1, relinks: 1, unlinks: 0, retried: 0 });
  assertEquals(fake.ended(), 1);
});

Deno.test("the same hardcover_id prints nothing", async () => {
  const fake = fakeSql([SAME]);
  const h = harness(fake, {
    2: {
      found: { book: { id: 5, title: "T" } as never, status: "nli" },
      failed: false,
    },
  });
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.logs.map((l) => JSON.parse(l)), [
    { checked: 1, relinks: 0, unlinks: 0, retried: 0 },
  ]);
});

Deno.test("a box set with no match prints an unlink", async () => {
  const fake = fakeSql([BOX]);
  const h = harness(fake, { 3: { found: null, failed: false } });
  assertEquals(await main([], h.deps), 0);
  assertEquals(JSON.parse(h.logs[0]).action, "unlink");
  assertEquals(JSON.parse(h.logs[1]), { checked: 1, relinks: 0, unlinks: 1, retried: 0 });
});

Deno.test("a provider failure never relinks or unlinks", async () => {
  const fake = fakeSql([BOX]);
  const h = harness(fake, { 3: { found: null, failed: true } });
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(JSON.parse(h.logs[0]), {
    simania_id: 3,
    skipped: "provider_failure",
  });
  assert(!fake.queries.some((q) => /^\s*update/i.test(q.text)));
  assertEquals(h.repairs.length, 0);
  assertEquals(JSON.parse(h.logs.at(-1)!), {
    relinked: 0,
    unlinked: 0,
    skipped: 0,
  });
});

Deno.test("--apply relinks with the new status and unlinks conditionally", async () => {
  const fake = fakeSql([RELINK, BOX]);
  const h = harness(fake, {
    16301: { ...rebel, found: { ...rebel.found!, status: "nli" } },
    3: { found: null, failed: false },
  });
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(h.opens, [{ readOnly: false }]);
  assertEquals(h.repairs.length, 1);
  const plan = h.repairs[0].plan as { kind: string; work_id: string };
  assertEquals(plan.kind, "relink");
  assertEquals(plan.work_id, "work-old");
  assertEquals(h.repairs[0].status, "nli");
  const update = fake.queries.find((q) => /^\s*update/i.test(q.text))!;
  assert(update.text.includes("work_id = null"));
  assert(update.text.includes("resolve_status = 'not_found'"));
  assert(update.text.includes("and work_id = ?"));
  assert(update.values.includes("work-box"));
  assertEquals(JSON.parse(h.logs.at(-1)!), {
    relinked: 1,
    unlinked: 1,
    skipped: 0,
  });
});

Deno.test("a lost race counts as skipped", async () => {
  const fake = fakeSql([BOX], 0);
  const h = harness(fake, { 3: { found: null, failed: false } });
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(JSON.parse(h.logs.at(-1)!), {
    relinked: 0,
    unlinked: 0,
    skipped: 1,
  });
});

Deno.test("a failed budget check exits 4 without resolving", async () => {
  const fake = fakeSql([RELINK]);
  const h = harness(fake, { 16301: rebel });
  const code = await main([], {
    ...h.deps,
    checkHardcoverBudget: () => Promise.resolve(false),
  });
  assertEquals(code, 4);
  assertEquals(h.resolved.length, 0);
  assertEquals(h.opens.length, 0);
});

Deno.test("bad flags print usage and exit 2", async () => {
  const h = harness(fakeSql([]), {});
  assertEquals(await main(["--bogus"], h.deps), 2);
  assertEquals(await main(["--simania"], h.deps), 2);
  assert(h.errors[0].startsWith("Usage"));
});

Deno.test("scope: used works by default, every automatic link with --all", async () => {
  const scoped = fakeSql([]);
  await main([], harness(scoped, {}).deps);
  const all = fakeSql([]);
  await main(["--all"], harness(all, {}).deps);
  const one = fakeSql([]);
  await main(["--simania", "16301"], harness(one, {}).deps);
  for (const f of [scoped, all, one]) {
    const q = f.queries[0].text;
    assert(q.includes("'wikidata', 'nli', 'fuzzy'"));
    assert(!q.includes("'pending'") && !q.includes("'not_found'"));
  }
  assert(scoped.queries[0].text.includes("shelf_books"));
  assert(!all.queries[0].text.includes("shelf_books"));
  assert(!one.queries[0].text.includes("shelf_books"));
  assert(one.queries[0].values.includes(16301));
});

Deno.test("a provider failure is retried once and can relink", async () => {
  const fake = fakeSql([RELINK]);
  const h = harness(fake, {});
  let calls = 0;
  h.deps.resolveMatch = () =>
    Promise.resolve(
      ++calls === 1 ? { found: null, failed: true } as Match : rebel,
    );
  assertEquals(await main([], h.deps), 0);
  assertEquals(calls, 2);
  assert(h.sleeps.length === 1 && h.sleeps[0] >= 2000);
  const lines = h.logs.map((l) => JSON.parse(l));
  assertEquals(lines.filter((l) => l.skipped).length, 0);
  assertEquals(lines[0].action, "relink");
  assertEquals(lines.at(-1), {
    checked: 1,
    relinks: 1,
    unlinks: 0,
    retried: 1,
  });
});

Deno.test("an edition that fails twice prints one provider_failure", async () => {
  const fake = fakeSql([BOX]);
  const h = harness(fake, { 3: { found: null, failed: true } });
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.resolved, [3, 3]);
  const lines = h.logs.map((l) => JSON.parse(l));
  assertEquals(lines[0], { simania_id: 3, skipped: "provider_failure" });
  assertEquals(lines.filter((l) => l.skipped).length, 1);
  assertEquals(lines.at(-1), {
    checked: 1,
    relinks: 0,
    unlinks: 0,
    retried: 1,
  });
});

Deno.test("with no failures sleep is never called", async () => {
  const fake = fakeSql([RELINK]);
  const h = harness(fake, { 16301: rebel });
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.sleeps.length, 0);
  assertEquals(JSON.parse(h.logs.at(-1)!).retried, 0);
});

async function searchDocumentBook() {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("HARDCOVER_API_KEY");
  Deno.env.set("HARDCOVER_API_KEY", "test-key");
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({
        data: {
          search: {
            ids: [488917],
            results: {
              hits: [{
                document: {
                  id: "488917",
                  title: "The Rebel",
                  contributions: [{ author: { name: "Albert Camus" } }],
                },
              }],
            },
          },
        },
      })),
    );
  try {
    const book = await findHardcoverBook("The Rebel", "Albert Camus");
    assert(book);
    return book;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) Deno.env.delete("HARDCOVER_API_KEY");
    else Deno.env.set("HARDCOVER_API_KEY", originalKey);
  }
}

Deno.test("--apply fetches details before relinking a search-document book", async () => {
  const book = await searchDocumentBook();
  const fake = fakeSql([RELINK]);
  const h = harness(fake, {
    16301: { found: { book, status: "wikidata" }, failed: false },
  });
  const calls: number[][] = [];
  h.deps.hardcoverBooks = (ids) => {
    calls.push(ids);
    return Promise.resolve([
      { id: 488917, title: "The Rebel", cached_similar_book_ids: [7] },
    ]);
  };
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(calls, [[488917]]);
  const plan = h.repairs[0].plan as {
    book: { cached_similar_book_ids: number[] };
    proposal: { book: { cached_similar_book_ids: number[] } };
  };
  assertEquals(plan.book.cached_similar_book_ids, [7]);
  assertEquals(plan.proposal.book.cached_similar_book_ids, [7]);
});

Deno.test("--apply skips a relink when the details fetch fails", async () => {
  const book = await searchDocumentBook();
  const fake = fakeSql([RELINK]);
  const h = harness(fake, {
    16301: { found: { book, status: "wikidata" }, failed: false },
  });
  h.deps.hardcoverBooks = () => Promise.reject(new Error("boom"));
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(h.repairs.length, 0);
  const lines = h.logs.map((l) => JSON.parse(l));
  assert(lines.some((l) => l.simania_id === 16301 && l.skipped === "details_failure"));
  assertEquals(lines.at(-1), { relinked: 0, unlinked: 0, skipped: 1 });
});

Deno.test("--apply does not fetch details for a plain book", async () => {
  const fake = fakeSql([RELINK]);
  const h = harness(fake, { 16301: rebel });
  let called = 0;
  h.deps.hardcoverBooks = () => {
    called++;
    return Promise.resolve([]);
  };
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(called, 0);
  assertEquals(h.repairs.length, 1);
});
