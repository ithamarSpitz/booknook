import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { Sql } from "npm:postgres@3.4.5";
import { codeHash, main, refreshReader } from "../../scripts/refresh-all.ts";

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
  assertEquals(JSON.parse(logs.at(-1)!), summary);
});

Deno.test("a failed link-edition prints sanitized book failure details", async () => {
  const db = fakeSql();
  const logs: string[] = [];
  const summary = await refreshReader({
    keys,
    sql: db.sql,
    readerToken: async () => "reader-token",
    callAs: async (_keys, _token, name) => {
      if (name === "recommendations") {
        return {
          recommendations: [{
            work_id: "work-1",
            title: "The Book",
            english_only: true,
            simania_id: null,
          }],
        };
      }
      if (name === "link-edition") {
        throw Object.assign(
          new Error(`conflict eyJabc.def.ghi ${"x".repeat(250)}`),
          { status: 409 },
        );
      }
      return {};
    },
    fetchSimaniaPayload: async () => ({ details: {}, rating: null }),
    localizeRecommendations: async (items, deps) => {
      await deps.callFunction("link-edition", {
        work_id: items[0]?.work_id,
        simania_id: 2970,
        source: "wikidata",
      });
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    sleep: async () => {},
    log: (line) => logs.push(line),
  }, { id: "reader", email: "reader@example.test" });

  const failures = logs.map((line) => JSON.parse(line)).filter((line) =>
    typeof line.failed === "object"
  );
  assertEquals(failures.length, 1);
  assertEquals(failures[0].failed, {
    title: "The Book",
    step: "localize",
    function: "link-edition",
    status: 409,
    message: `conflict [redacted] ${"x".repeat(180)}`,
  });
  assertEquals(failures[0].failed.message.length, 200);
  assertEquals(summary.failed, 1);
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
      for (const item of items) {
        const fallback = item.work_id === "fallback";
        await deps.callFunction("link-edition", {
          work_id: item.work_id,
          simania_id: fallback ? 1 : 2,
          source: fallback ? "nli_author" : "wikidata",
        });
        deps.onLinked(String(item.work_id), {
          simania_id: fallback ? 1 : 2,
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
    listBareEditionIds: async () => [
      { simania_id: 11, title: "first" },
      { simania_id: 22, title: "second" },
    ],
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
    skipped: 0,
  });
  assertEquals(JSON.parse(logs.at(-1)!), summary);
});

function stagger(index: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, index % 3));
}

function genreRow(workId: string) {
  return {
    work_id: workId,
    hardcover_id: 1,
    simania_id: null,
    title: workId,
    author: null,
    cover_url: null,
    english_only: true as const,
    because: [],
    because_titles: [],
  };
}

Deno.test("concurrent localization has the same summary and link bodies", async () => {
  const run = async (concurrency: number) => {
    const db = fakeSql();
    const linkBodies = new Set<string>();
    const cards = Array.from({ length: 6 }, (_, index) => ({
      work_id: `card-${index}`,
      title: `card-${index}`,
      english_only: true,
    }));
    const genres = Array.from(
      { length: 6 },
      (_, index) => genreRow(`genre-${index}`),
    );
    const summary = await refreshReader({
      keys,
      sql: db.sql,
      concurrency,
      readerToken: async () => "token",
      callAs: async (_keys, _token, name, body) => {
        if (name === "recommendations") return { recommendations: cards };
        if (name === "genre-hint") {
          const request = body as Record<string, unknown>;
          await stagger(Number(String(request.work_id).at(-1)));
          return {};
        }
        if (name === "link-edition") linkBodies.add(JSON.stringify(body));
        return body;
      },
      fetchSimaniaPayload: async () => ({ details: {}, rating: null }),
      localizeRecommendations: async (items, deps) => {
        const workId = String(items[0]?.work_id);
        const index = Number(workId.at(-1));
        await stagger(2 - index % 3);
        if (workId === "card-5") throw new Error("one failure");
        if (index % 2 === 0) {
          const body = {
            work_id: workId,
            simania_id: 100 + index,
            source: "wikidata",
          };
          await deps.callFunction("link-edition", body);
          deps.onLinked(workId, {
            simania_id: 100 + index,
            title: "linked",
            author: null,
            cover_url: null,
          });
        }
      },
      countReaderRows: async () => ({
        englishRecommendations: 6,
        englishGenres: 6,
        bareEditions: 0,
      }),
      listEnglishGenreRows: async () => genres,
      listBareEditionIds: async () => [],
      sleep: async () => {},
      log: () => {},
    }, { id: "reader", email: "reader@example.test" });
    return { summary, linkBodies };
  };

  const serial = await run(1);
  const concurrent = await run(4);
  assertEquals(concurrent.summary, serial.summary);
  assertEquals(concurrent.linkBodies, serial.linkBodies);
});

Deno.test("localization worker pool never exceeds its configured size", async () => {
  const db = fakeSql();
  let active = 0;
  let maxActive = 0;
  const cards = Array.from({ length: 8 }, (_, index) => ({
    work_id: `work-${index}`,
    title: `work-${index}`,
    english_only: true,
  }));

  await refreshReader({
    keys,
    sql: db.sql,
    concurrency: 3,
    readerToken: async () => "token",
    callAs: async (_keys, _token, name) =>
      name === "recommendations" ? { recommendations: cards } : {},
    fetchSimaniaPayload: async () => ({ details: {}, rating: null }),
    localizeRecommendations: async (items) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await stagger(Number(String(items[0]?.work_id).at(-1)));
      active--;
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    sleep: async () => {},
    log: () => {},
  }, { id: "reader", email: "reader@example.test" });

  assertEquals(maxActive, 3);
  assertEquals(active, 0);
});

Deno.test("one Simania throttle is shared across concurrent books and readers", async () => {
  const db = fakeSql();
  let clock = 0;
  const starts: number[] = [];
  const readers = [
    { id: "reader-1", email: "a@example.test" },
    { id: "reader-2", email: "b@example.test" },
  ];
  const cards = Array.from({ length: 4 }, (_, index) => ({
    work_id: `work-${index}`,
    title: `work-${index}`,
    english_only: true,
  }));

  const code = await main(["--apply", "--concurrency", "4"], {
    projectKeys: async () => keys,
    listReaders: async () => readers,
    openProdDb: async () => db.sql,
    readerToken: async (_keys, email) => `token:${email}`,
    callAs: async (_keys, _token, name) =>
      name === "recommendations" ? { recommendations: cards } : {},
    fetchSimaniaPayload: async () => {
      starts.push(clock);
      return { details: {}, rating: null };
    },
    localizeRecommendations: async (_items, deps) => {
      await deps.fetchPayload!(1);
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async (_sql, readerId) => [{
      simania_id: readerId === "reader-1" ? 11 : 12,
      title: "bare",
    }],
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    log: () => {},
  });

  assertEquals(code, 0);
  assertEquals(starts.length, 10);
  for (let index = 1; index < starts.length; index++) {
    assertEquals(starts[index] - starts[index - 1] >= 1_000, true);
  }
});

Deno.test("bad concurrency exits before any network or database call", async () => {
  for (const value of ["0", "9", "x"]) {
    let calls = 0;
    const errors: string[] = [];
    const code = await main(["--apply", "--concurrency", value], {
      projectKeys: async () => {
        calls++;
        return keys;
      },
      error: (message) => errors.push(message),
    });
    assertEquals(code, 2);
    assertEquals(calls, 0);
    assertStringIncludes(errors[0], "--concurrency");
  }
});

const fakeNow = new Date("2026-11-20T12:00:00.000Z");

function recommendation(workId: string) {
  return { work_id: workId, title: workId, english_only: true };
}

Deno.test("skip cache avoids cached cards and genre rows", async () => {
  const db = fakeSql();
  const calls: string[] = [];
  const logs: string[] = [];
  const writes: string[] = [];
  const checked = new Date(fakeNow.getTime() - 24 * 60 * 60 * 1_000)
    .toISOString();
  const result = await main(["--apply", "--skip-cache", "cache.json"], {
    readCache: async () =>
      JSON.stringify({
        code: "same-code",
        entries: { card: checked, genre: checked },
      }),
    writeCache: async (_path, contents) => {
      writes.push(contents);
    },
    codeHash: async () => "same-code",
    now: () => fakeNow,
    projectKeys: async () => keys,
    listReaders: async () => [{ id: "reader", email: "reader@example.test" }],
    openProdDb: async () => db.sql,
    readerToken: async () => "token",
    callAs: async (_keys, _token, name) => {
      calls.push(name);
      return name === "recommendations"
        ? { recommendations: [recommendation("card")] }
        : {};
    },
    localizeRecommendations: async () => {
      calls.push("localize");
    },
    fetchSimaniaPayload: async () => {
      calls.push("simania");
      return { details: {}, rating: null };
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [genreRow("genre")],
    listBareEditionIds: async () => [],
    log: (line) => logs.push(line),
  });

  assertEquals(result, 0);
  assertEquals(calls, ["recommendations"]);
  assertEquals(JSON.parse(logs.at(-1)!).skipped, 2);
  assertEquals(writes.length, 1);
});

Deno.test("stale entries and entries under another code hash are checked", async () => {
  const run = async (cacheCode: string, checked: string) => {
    const db = fakeSql();
    let localized = 0;
    await main(["--apply", "--skip-cache", "cache.json"], {
      readCache: async () =>
        JSON.stringify({
          code: cacheCode,
          entries: { work: checked },
        }),
      writeCache: async () => {},
      codeHash: async () => "current-code",
      now: () => fakeNow,
      projectKeys: async () => keys,
      listReaders: async () => [{ id: "reader", email: "reader@example.test" }],
      openProdDb: async () => db.sql,
      readerToken: async () => "token",
      callAs: async (_keys, _token, name) =>
        name === "recommendations"
          ? { recommendations: [recommendation("work")] }
          : {},
      localizeRecommendations: async () => {
        localized++;
      },
      countReaderRows: async () => zeroCounts,
      listEnglishGenreRows: async () => [],
      listBareEditionIds: async () => [],
      log: () => {},
    });
    return localized;
  };

  const eightDaysOld = new Date(
    fakeNow.getTime() - 8 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  assertEquals(await run("current-code", eightDaysOld), 1);
  assertEquals(await run("old-code", fakeNow.toISOString()), 1);
});

Deno.test("cache adds only clean no-result books", async () => {
  const db = fakeSql();
  let written = "";
  await main(["--apply", "--skip-cache", "cache.json"], {
    readCache: async () => null,
    writeCache: async (_path, contents) => {
      written = contents;
    },
    codeHash: async () => "code",
    now: () => fakeNow,
    projectKeys: async () => keys,
    listReaders: async () => [{ id: "reader", email: "reader@example.test" }],
    openProdDb: async () => db.sql,
    readerToken: async () => "token",
    callAs: async (_keys, _token, name) =>
      name === "recommendations"
        ? {
          recommendations: [
            recommendation("no-result"),
            recommendation("linked"),
            recommendation("failed"),
          ],
        }
        : {},
    localizeRecommendations: async (items, deps) => {
      const workId = String(items[0]?.work_id);
      if (workId === "linked") {
        deps.onLinked(workId, {
          simania_id: 1,
          title: "linked",
          author: null,
          cover_url: null,
        });
      }
      if (workId === "failed") throw new Error("failed");
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    log: () => {},
  });

  assertEquals(JSON.parse(written), {
    code: "code",
    entries: { "no-result": fakeNow.toISOString() },
  });
});

Deno.test("a no-result check is reused by later readers in the same run", async () => {
  const db = fakeSql();
  let localized = 0;
  const summaries: Record<string, unknown>[] = [];
  await main(["--apply", "--skip-cache", "cache.json"], {
    readCache: async () => null,
    writeCache: async () => {},
    codeHash: async () => "code",
    now: () => fakeNow,
    projectKeys: async () => keys,
    listReaders: async () => [
      { id: "reader-a", email: "a@example.test" },
      { id: "reader-b", email: "b@example.test" },
    ],
    openProdDb: async () => db.sql,
    readerToken: async (_keys, email) => `token:${email}`,
    callAs: async (_keys, _token, name) =>
      name === "recommendations"
        ? { recommendations: [recommendation("shared-work")] }
        : {},
    localizeRecommendations: async () => {
      localized++;
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    log: (line) => summaries.push(JSON.parse(line)),
  });

  assertEquals(localized, 1);
  assertEquals(summaries.map((summary) => summary.skipped), [0, 1]);
});

Deno.test("invalid cache JSON exits before network calls", async () => {
  let networkCalls = 0;
  let writes = 0;
  const result = await main(["--apply", "--skip-cache", "cache.json"], {
    readCache: async () => "{bad",
    writeCache: async () => {
      writes++;
    },
    codeHash: async () => "code",
    projectKeys: async () => {
      networkCalls++;
      return keys;
    },
    error: () => {},
  });

  assertEquals(result, 2);
  assertEquals(networkCalls, 0);
  assertEquals(writes, 0);
});

Deno.test("cache is written once when a later reader session stops the run", async () => {
  const db = fakeSql();
  const writes: string[] = [];
  const result = await main(["--apply", "--skip-cache", "cache.json"], {
    readCache: async () => null,
    writeCache: async (_path, contents) => {
      writes.push(contents);
    },
    codeHash: async () => "code",
    now: () => fakeNow,
    projectKeys: async () => keys,
    listReaders: async () => [
      { id: "reader-a", email: "a@example.test" },
      { id: "reader-b", email: "b@example.test" },
    ],
    openProdDb: async () => db.sql,
    readerToken: async (_keys, email) => {
      if (email === "b@example.test") throw new Error("session failed");
      return "token-a";
    },
    callAs: async (_keys, _token, name) =>
      name === "recommendations"
        ? { recommendations: [recommendation("checked")] }
        : {},
    localizeRecommendations: async () => {},
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [],
    listBareEditionIds: async () => [],
    log: () => {},
    error: () => {},
  });

  assertEquals(result, 2);
  assertEquals(writes.length, 1);
  assertEquals(JSON.parse(writes[0]).entries, {
    checked: fakeNow.toISOString(),
  });
});

Deno.test("codeHash includes file paths and contents but not input order", async () => {
  const files = [
    { path: "public/js/a.js", contents: "one" },
    { path: "supabase/functions/b.ts", contents: "two" },
  ];
  const original = await codeHash(files);
  assertEquals(await codeHash([...files].reverse()), original);
  assertEquals(
    await codeHash([{ ...files[0], contents: "changed" }, files[1]]) ===
      original,
    false,
  );
  assertEquals(
    await codeHash([
      { ...files[0], path: "public/js/renamed.js" },
      files[1],
    ]) ===
      original,
    false,
  );
});

Deno.test("without skip-cache every English-only book is checked", async () => {
  const db = fakeSql();
  let localized = 0;
  let cacheReads = 0;
  const logs: string[] = [];
  await main(["--apply"], {
    readCache: async () => {
      cacheReads++;
      return null;
    },
    projectKeys: async () => keys,
    listReaders: async () => [{ id: "reader", email: "reader@example.test" }],
    openProdDb: async () => db.sql,
    readerToken: async () => "token",
    callAs: async (_keys, _token, name) =>
      name === "recommendations"
        ? { recommendations: [recommendation("card")] }
        : {},
    localizeRecommendations: async () => {
      localized++;
    },
    countReaderRows: async () => zeroCounts,
    listEnglishGenreRows: async () => [genreRow("genre")],
    listBareEditionIds: async () => [],
    log: (line) => logs.push(line),
  });

  assertEquals(cacheReads, 0);
  assertEquals(localized, 2);
  assertEquals(JSON.parse(logs.at(-1)!).skipped, 0);
});
