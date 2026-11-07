import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.14";
import type { Sql } from "npm:postgres@3.4.5";
import {
  runUnlinkFallback,
  unlinkFallback,
} from "../../scripts/unlink-fallback.ts";

function fakeSqlForRun() {
  let ended = 0;
  const sql = {
    end: () => {
      ended += 1;
    },
  } as unknown as Sql;
  return { sql, ended: () => ended };
}

Deno.test("dry run lists only fallback links and makes no write call", async () => {
  const fake = fakeSqlForRun();
  const openOptions: Array<{ readOnly?: boolean }> = [];
  const logs: string[] = [];
  let writes = 0;

  const code = await runUnlinkFallback([], {
    loadOperatorEnv: () => ({ dbPassword: "unused" }),
    openProdDb: (options) => {
      openOptions.push(options ?? {});
      return Promise.resolve(fake.sql);
    },
    fallbackLinks: () =>
      Promise.resolve([{
        simania_id: 5,
        title: "כותרת",
        hardcover_id: 50,
        original_title: "Title",
      }]),
    unlinkFallback: () => {
      writes += 1;
      return Promise.resolve({
        editions: 0,
        recommendations: 0,
        genre_recommendations: 0,
      });
    },
    log: (message) => logs.push(message),
  });

  assertEquals(code, 0);
  assertEquals(openOptions, [{ readOnly: true }]);
  assertEquals(writes, 0);
  assertEquals(logs.map((line) => JSON.parse(line)), [{
    simania_id: 5,
    title: "כותרת",
    hardcover_id: 50,
    original_title: "Title",
  }, { count: 1 }]);
  assertEquals(fake.ended(), 1);
});

function transactionalSql(
  editionRows: Array<{ simania_id: number }>,
  recommendationRows: Array<{ simania_id: number }>,
  genreRows: Array<{ simania_id: number }>,
) {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const results = [editionRows, recommendationRows, genreRows];
  let call = 0;
  const tx = (strings: TemplateStringsArray, ...parameters: unknown[]) => {
    statements.push(strings.reduce(
      (text, part, index) =>
        text + part + (index < parameters.length ? "?" : ""),
      "",
    ));
    values.push(parameters);
    return Promise.resolve(results[call++]);
  };
  const sql = {
    begin: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      statements.push("BEGIN");
      const result = await run(tx);
      statements.push("COMMIT");
      return result;
    },
  } as unknown as Sql;
  return { sql, statements, values };
}

Deno.test("apply updates editions and both recommendation tables in one transaction", async () => {
  const fake = transactionalSql(
    [{ simania_id: 5 }, { simania_id: 6 }],
    [{ simania_id: 5 }],
    [{ simania_id: 6 }, { simania_id: 6 }],
  );

  const counts = await unlinkFallback(fake.sql);

  assertEquals(counts, {
    editions: 2,
    recommendations: 1,
    genre_recommendations: 2,
  });
  assertEquals(fake.statements[0], "BEGIN");
  assertMatch(fake.statements[1], /update public\.editions/i);
  assertMatch(fake.statements[1], /resolve_status::text = 'nli_author'/i);
  assertMatch(fake.statements[1], /resolve_status = 'pending'/i);
  assertMatch(fake.statements[2], /update public\.recommendations/i);
  assertMatch(fake.statements[3], /update public\.genre_recommendations/i);
  assertEquals(fake.statements[4], "COMMIT");
  assertEquals(fake.values[1][0], [5, 6]);
  assertEquals(fake.values[2][0], [5, 6]);
});

Deno.test("named apply touches only a named nli_author edition", async () => {
  const fake = transactionalSql([{ simania_id: 5 }], [], []);
  await unlinkFallback(fake.sql, 5);

  assertMatch(fake.statements[1], /resolve_status::text = 'nli_author'/i);
  assertMatch(fake.statements[1], /simania_id = \?/i);
  assertEquals(fake.values[0], [5, 5]);
  assertEquals(fake.values[1][0], [5]);
  assertEquals(fake.values[2][0], [5]);

  const wrongStatus = transactionalSql([], [], []);
  const counts = await unlinkFallback(wrongStatus.sql, 5);
  assertEquals(counts, {
    editions: 0,
    recommendations: 0,
    genre_recommendations: 0,
  });
  assertEquals(wrongStatus.values[1][0], []);
  assertEquals(wrongStatus.values[2][0], []);
});

Deno.test("bad argument exits 2 before loading credentials or opening the DB", async () => {
  let loaded = 0;
  let opened = 0;
  const errors: string[] = [];
  const code = await runUnlinkFallback(["--simania", "5"], {
    loadOperatorEnv: () => {
      loaded += 1;
      return { dbPassword: "unused" };
    },
    openProdDb: () => {
      opened += 1;
      return Promise.resolve(fakeSqlForRun().sql);
    },
    error: (message) => errors.push(message),
  });

  assertEquals(code, 2);
  assertEquals(loaded, 0);
  assertEquals(opened, 0);
  assertEquals(errors.length, 1);
});
