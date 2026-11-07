import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { Sql } from "npm:postgres@3.4.5";
import { main, refreshReader } from "../../scripts/refresh-all.ts";

const keys = {
  url: "https://example.test",
  anonKey: "anon-key-secret",
  serviceKey: "service-key-secret",
};

function fakeSql() {
  let ended = 0;
  return {
    sql: { end: () => ended++ } as unknown as Sql,
    ended: () => ended,
  };
}

const zeroCounts = {
  englishRecommendations: 0,
  englishGenres: 0,
  bareEditions: 0,
};

Deno.test("refresh-all dry run only gets keys, readers, and before counts", async () => {
  const db = fakeSql();
  const calls: string[] = [];
  const logs: string[] = [];
  const code = await main([], {
    projectKeys: async () => {
      calls.push("keys");
      return keys;
    },
    listReaders: async () => {
      calls.push("readers");
      return [
        { id: "reader-1", email: "a@example.test" },
        { id: "reader-2", email: "b@example.test" },
      ];
    },
    openProdDb: async (options) => {
      calls.push(`db:${options?.readOnly}`);
      return db.sql;
    },
    countReaderRows: async (_sql, id) => {
      calls.push(`counts:${id}`);
      return {
        ...zeroCounts,
        englishRecommendations: id === "reader-1" ? 2 : 3,
      };
    },
    readerToken: async () => {
      calls.push("SESSION-MUST-NOT-RUN");
      return "token";
    },
    callAs: async () => {
      calls.push("FUNCTION-MUST-NOT-RUN");
      return {};
    },
    log: (line) => logs.push(line),
  });

  assertEquals(code, 0);
  assertEquals(calls, [
    "keys",
    "readers",
    "db:true",
    "counts:reader-1",
    "counts:reader-2",
  ]);
  assertEquals(db.ended(), 1);
  assertEquals(JSON.parse(logs[0]).before.englishRecommendations, 2);
  assertEquals(JSON.parse(logs[1]).before.englishRecommendations, 3);
});

Deno.test("apply processes two readers sequentially with each reader token", async () => {
  const db = fakeSql();
  const events: string[] = [];
  let active = 0;
  let maxActive = 0;
  const readers = [
    { id: "reader-1", email: "a@example.test" },
    { id: "reader-2", email: "b@example.test" },
  ];

  const code = await main(["--apply"], {
    projectKeys: async () => keys,
    listReaders: async () => readers,
    openProdDb: async () => db.sql,
    readerToken: async (_keys, email) => {
      events.push(`session:${email}`);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      return `token:${email}`;
    },
    callAs: async (_keys, token, name) => {
      events.push(`${name}:${token}`);
      if (name === "recommendations") active--;
      return name === "recommendations" ? { recommendations: [] } : {};
    },
    countReaderRows: async (_sql, id) => {
      events.push(`counts:${id}`);
      return zeroCounts;
    },
    listEnglishGenreRows: async (_sql, id) => {
      events.push(`genres:${id}`);
      return [];
    },
    listBareEditionIds: async (_sql, id) => {
      events.push(`editions:${id}`);
      return [];
    },
    log: () => {},
  });

  assertEquals(code, 0);
  assertEquals(maxActive, 1);
  assertEquals(events, [
    "counts:reader-1",
    "session:a@example.test",
    "recommendations:token:a@example.test",
    "genres:reader-1",
    "editions:reader-1",
    "counts:reader-1",
    "counts:reader-2",
    "session:b@example.test",
    "recommendations:token:b@example.test",
    "genres:reader-2",
    "editions:reader-2",
    "counts:reader-2",
  ]);
});

Deno.test("a step 3 book failure is counted and later genre books continue", async () => {
  const db = fakeSql();
  const localized: string[] = [];
  const logs: string[] = [];
  const row = (work_id: string) => ({
    work_id,
    hardcover_id: 1,
    simania_id: null,
    title: work_id,
    author: null,
    cover_url: null,
    english_only: true as const,
    because: [],
    because_titles: [],
  });

  const summary = await refreshReader({
    keys,
    sql: db.sql,
    readerToken: async () => "reader-token",
    callAs: async (_keys, token, name, body) => {
      assertEquals(token, "reader-token");
      if (name === "recommendations") return { recommendations: [] };
      if (name === "genre-hint") {
        return {
          work_id: (body as Record<string, unknown>).work_id,
          hebrew_hint: { title: "רמז" },
        };
      }
      return {};
    },
    fetchSimaniaPayload: async () => ({ details: {}, rating: null }),
    localizeRecommendations: async (items, deps) => {
      const workId = String(items[0]?.work_id ?? "");
      if (!workId) return;
      localized.push(workId);
      if (workId === "bad") throw new Error("one book failed");
      deps.onLinked(workId, {
        simania_id: 10,
        title: "עברית",
        author: null,
        cover_url: null,
      });
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [row("bad"), row("good")],
    listBareEditionIds: async () => [],
    sleep: async () => {},
    log: (line) => logs.push(line),
  }, { id: "reader", email: "reader@example.test" });

  assertEquals(localized, ["bad", "good"]);
  assertEquals(summary.failed, 1);
  assertEquals(summary.booksLinked, 1);
  assertEquals(JSON.parse(logs[0]), summary);
});

Deno.test("an English-only card without a hint or Hebrew author is localized", async () => {
  const db = fakeSql();
  const localized: Record<string, unknown>[] = [];
  const functionCalls: Array<{ token: string; name: string }> = [];

  await refreshReader({
    keys,
    sql: db.sql,
    readerToken: async () => "reader-token",
    callAs: async (_keys, token, name) => {
      functionCalls.push({ token, name });
      return name === "recommendations"
        ? {
          recommendations: [{
            work_id: "fallback-work",
            english_only: true,
            simania_id: null,
            hebrew_hint: null,
            hebrew_author: null,
          }],
        }
        : {};
    },
    fetchSimaniaPayload: async () => ({ details: {}, rating: null }),
    localizeRecommendations: async (items, deps) => {
      localized.push(...items);
      await deps.callFunction("hebrew-candidates", {
        work_id: items[0]?.work_id,
      });
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    sleep: async () => {},
    log: () => {},
  }, { id: "reader", email: "reader@example.test" });

  assertEquals(localized.map((item) => item.work_id), ["fallback-work"]);
  assertEquals(functionCalls, [
    { token: "reader-token", name: "recommendations" },
    { token: "reader-token", name: "hebrew-candidates" },
  ]);
});

Deno.test("fallbackLinked counts only successful nli_author links", async () => {
  const db = fakeSql();
  const summary = await refreshReader({
    keys,
    sql: db.sql,
    readerToken: async () => "reader-token",
    callAs: async (_keys, _token, name, body) => {
      if (name === "recommendations") {
        return {
          recommendations: [
            { work_id: "fallback", english_only: true },
            { work_id: "ordinary", english_only: true },
          ],
        };
      }
      if (name === "link-edition") {
        return { simania_id: (body as Record<string, unknown>).simania_id };
      }
      return {};
    },
    fetchSimaniaPayload: async () => ({ details: {}, rating: null }),
    localizeRecommendations: async (items, deps) => {
      for (const [index, item] of items.entries()) {
        await deps.callFunction("link-edition", {
          work_id: item.work_id,
          simania_id: index + 1,
          source: index === 0 ? "nli_author" : "wikidata",
        });
        deps.onLinked(String(item.work_id), {
          simania_id: index + 1,
          title: "linked",
          author: null,
          cover_url: null,
        });
      }
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    sleep: async () => {},
    log: () => {},
  }, { id: "reader", email: "reader@example.test" });

  assertEquals(summary.booksLinked, 2);
  assertEquals(summary.fallbackLinked, 1);
});

Deno.test("reader session failure exits 2 without printing tokens or keys", async () => {
  const db = fakeSql();
  const errors: string[] = [];
  const secrets = ["reader-token-secret", keys.anonKey, keys.serviceKey];
  const code = await main(["--apply"], {
    projectKeys: async () => keys,
    listReaders: async () => [{ id: "reader", email: "reader@example.test" }],
    openProdDb: async () => db.sql,
    countReaderRows: async () => zeroCounts,
    readerToken: async () => {
      throw new Error(secrets.join(" "));
    },
    error: (line) => errors.push(line),
  });

  assertEquals(code, 2);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], "session");
  for (const secret of secrets) assertEquals(errors[0].includes(secret), false);
});

Deno.test("summary reports before/after, links, fills, and failures from fakes", async () => {
  const db = fakeSql();
  let countCall = 0;
  const logs: string[] = [];
  const summary = await refreshReader({
    keys,
    sql: db.sql,
    readerToken: async () => "token",
    callAs: async (_keys, _token, name) =>
      name === "recommendations"
        ? {
          recommendations: [{
            work_id: "work-1",
            english_only: true,
            hebrew_hint: { title: "רמז" },
          }],
        }
        : {},
    fetchSimaniaPayload: async (id) =>
      id === 22
        ? Promise.reject(new Error("failed edition"))
        : { details: { title: "ספר" }, rating: null },
    localizeRecommendations: async (items, deps) => {
      for (const item of items) {
        deps.onLinked(String(item.work_id), {
          simania_id: 9,
          title: "ספר",
          author: null,
          cover_url: null,
        });
      }
    },
    countReaderRows: async () => {
      countCall++;
      return countCall === 1
        ? { englishRecommendations: 4, englishGenres: 3, bareEditions: 2 }
        : { englishRecommendations: 1, englishGenres: 1, bareEditions: 1 };
    },
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [11, 22],
    sleep: async () => {},
    log: (line) => logs.push(line),
  }, { id: "reader", email: "reader@example.test" });

  assertEquals(summary, {
    reader: "reader@example.test",
    englishBefore: 4,
    englishAfter: 1,
    genreBefore: 3,
    genreAfter: 1,
    booksLinked: 1,
    fallbackLinked: 0,
    editionsFilled: 1,
    failed: 1,
  });
  assertEquals(JSON.parse(logs[0]), summary);
});
