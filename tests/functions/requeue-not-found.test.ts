import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import type { Sql } from "npm:postgres@3.4.5";
import { main } from "../../scripts/requeue-not-found.ts";

const ROWS = [
  { simania_id: 32249, title: "כותרת", author: "מחבר" },
  { simania_id: 40000, title: "אחר", author: null },
];

function fakeSql(opts: { throwOn?: "select" } = {}) {
  const queries: { text: string; values: unknown[] }[] = [];
  let ended = 0;
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    queries.push({ text, values });
    if (text.includes("update public.editions")) {
      return Promise.resolve(
        (values[0] as number[]).map((simania_id) => ({ simania_id })),
      );
    }
    if (opts.throwOn === "select") return Promise.reject(new Error("boom"));
    const only = values.find((v) => typeof v === "number");
    return Promise.resolve(
      only === undefined ? ROWS : ROWS.filter((r) => r.simania_id === only),
    );
  };
  (fn as unknown as { end: () => void }).end = () => {
    ended += 1;
  };
  return { sql: fn as unknown as Sql, queries, ended: () => ended };
}

function harness(fake: ReturnType<typeof fakeSql>) {
  const opens: Array<{ readOnly?: boolean }> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    opens,
    logs,
    errors,
    deps: {
      loadOperatorEnv: () => ({ dbPassword: "unused" }),
      openProdDb: (options?: { readOnly?: boolean }) => {
        opens.push(options ?? {});
        return Promise.resolve(fake.sql);
      },
      log: (m: string) => logs.push(m),
      error: (m: string) => errors.push(m),
    },
  };
}

Deno.test("dry run opens read-only, does not update, prints rows and total", async () => {
  const fake = fakeSql();
  const h = harness(fake);
  const code = await main([], h.deps);
  assertEquals(code, 0);
  assertEquals(h.opens, [{ readOnly: true }]);
  assert(!fake.queries.some((q) => q.text.includes("update ")));
  assertEquals(h.logs.map((l) => JSON.parse(l)), [...ROWS, { total: 2 }]);
});

Deno.test("--apply opens writable and runs one update with both ids", async () => {
  const fake = fakeSql();
  const h = harness(fake);
  const code = await main(["--apply"], h.deps);
  assertEquals(code, 0);
  assertEquals(h.opens, [{ readOnly: false }]);
  const updates = fake.queries.filter((q) => q.text.includes("update "));
  assertEquals(updates.length, 1);
  assertEquals(updates[0].values, [[32249, 40000]]);
  assert(updates[0].text.includes("resolve_status = 'not_found'"));
  assert(updates[0].text.includes("work_id is null"));
  assertEquals(JSON.parse(h.logs.at(-1)!), { requeued: 2 });
});

Deno.test("--simania limits the select to that id", async () => {
  const fake = fakeSql();
  const h = harness(fake);
  assertEquals(await main(["--simania", "32249"], h.deps), 0);
  assertEquals(fake.queries[0].values, [32249]);
  assertEquals(h.logs.map((l) => JSON.parse(l)), [ROWS[0], { total: 1 }]);
});

Deno.test("--simania selects unreferenced editions too", async () => {
  const fake = fakeSql();
  const h = harness(fake);
  assertEquals(await main(["--simania", "145387"], h.deps), 0);
  const q = fake.queries[0];
  for (const t of ["shelf_books", "recommendations", "genre_recommendations"]) {
    assert(!q.text.includes(t));
  }
  assertEquals(q.values, [145387]);
});

Deno.test("without --simania the select keeps the reference conditions", async () => {
  const fake = fakeSql();
  const h = harness(fake);
  assertEquals(await main([], h.deps), 0);
  const q = fake.queries[0];
  for (const t of ["shelf_books", "recommendations", "genre_recommendations"]) {
    assert(q.text.includes(t));
  }
});

Deno.test("bad arguments exit 2 and open no database", async () => {
  for (const args of [["--simania", "x"], ["--foo"], ["--simania"]]) {
    const fake = fakeSql();
    const h = harness(fake);
    assertEquals(await main(args, h.deps), 2);
    assertEquals(h.opens, []);
    assertEquals(h.errors.length, 1);
    assert(h.errors[0].startsWith("Usage:"));
  }
});

Deno.test("sql.end is called on success and when a query throws", async () => {
  const ok = fakeSql();
  await main([], harness(ok).deps);
  assertEquals(ok.ended(), 1);

  const bad = fakeSql({ throwOn: "select" });
  let threw = false;
  try {
    await main([], harness(bad).deps);
  } catch {
    threw = true;
  }
  assert(threw);
  assertEquals(bad.ended(), 1);
});
