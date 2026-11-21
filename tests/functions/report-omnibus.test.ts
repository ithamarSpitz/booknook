import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import type { Sql } from "npm:postgres@3.4.5";
import { main } from "../../scripts/report-omnibus.ts";

const ROWS = [
  {
    simania_id: 1026206,
    title: "יומני רובורצח - כרך 1",
    author: "מרתה וולס",
    series: "יומני רובורצח",
    work_id: "w1",
    hardcover_id: 11,
    original_title: "All Systems Red",
    original_authors: ["Martha Wells"],
    resolved_at: "2026-11-01T00:00:00.000Z",
  },
  {
    simania_id: 5,
    title: "אחר",
    author: null,
    series: null,
    work_id: null,
    hardcover_id: null,
    original_title: null,
    original_authors: null,
    resolved_at: null,
  },
];

function setup(rows: unknown[]) {
  const queries: string[] = [];
  let ended = 0;
  const fn = (strings: TemplateStringsArray) => {
    queries.push(strings.join("?").replace(/\s+/g, " "));
    return Promise.resolve(rows);
  };
  (fn as unknown as { end: () => void }).end = () => {
    ended += 1;
  };
  const opens: Array<{ readOnly?: boolean }> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    queries,
    opens,
    logs,
    errors,
    ended: () => ended,
    deps: {
      loadOperatorEnv: () => ({ dbPassword: "unused" }),
      openProdDb: (options?: { readOnly?: boolean }) => {
        opens.push(options ?? {});
        return Promise.resolve(fn as unknown as Sql);
      },
      log: (m: string) => logs.push(m),
      error: (m: string) => errors.push(m),
    },
  };
}

Deno.test("prints rows with exact key order then total", async () => {
  const h = setup(ROWS);
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.opens, [{ readOnly: true }]);
  assertEquals(h.ended(), 1);
  assertEquals(h.logs.length, 3);
  const keys = [
    "simania_id",
    "title",
    "author",
    "series",
    "work_id",
    "hardcover_id",
    "original_title",
    "original_authors",
    "resolved_at",
  ];
  assertEquals(Object.keys(JSON.parse(h.logs[0])), keys);
  assertEquals(Object.keys(JSON.parse(h.logs[1])), keys);
  assertEquals(h.logs[2], '{"total":2}');
});

Deno.test("zero rows print only total 0", async () => {
  const h = setup([]);
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.logs, ['{"total":0}']);
  assertEquals(h.ended(), 1);
});

Deno.test("any argument prints usage, exits 2, opens nothing", async () => {
  const h = setup(ROWS);
  assertEquals(await main(["--apply"], h.deps), 2);
  assertEquals(h.errors, ["Usage: report:omnibus"]);
  assertEquals(h.opens.length, 0);
});

Deno.test("query filters omnibus and never writes", async () => {
  const h = setup(ROWS);
  await main([], h.deps);
  assertEquals(h.queries.length, 1);
  const q = h.queries[0].toLowerCase();
  assert(q.includes("resolve_status = 'omnibus'"));
  assert(!/\b(update|insert|delete)\b/.test(q));
});
