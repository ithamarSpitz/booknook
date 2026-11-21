import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import type { Sql } from "npm:postgres@3.4.5";
import { applyRepair } from "../../scripts/repair-links.ts";
import {
  acceptSeries,
  booksAtPositionQuery,
  main,
  pickBook,
  type SeriesAnchor,
  type SeriesBook,
  seriesOfBookQuery,
} from "../../scripts/series-links.ts";

const SERIES = "השביעיה הסודית";
const AUTHOR = "אניד בליטון";

function book(
  id: number,
  title: string,
  readers: number,
  extra: Partial<SeriesBook> = {},
): SeriesBook {
  return {
    id,
    title,
    users_read_count: readers,
    cached_contributors: [{ author: { name: "Enid Blyton" } }],
    ...extra,
  };
}

Deno.test("pickBook prefers the dominant edition of one title", () => {
  const picked = pickBook([
    book(82054, "Well Done, Secret Seven", 1),
    book(67535, "Well Done, Secret Seven", 36),
  ], ["Enid Blyton"]);
  assertEquals("book" in picked && picked.book.id, 67535);
});

Deno.test("pickBook ignores a rare wrong title", () => {
  const picked = pickBook([
    book(2999497, "The Secret Seven", 1),
    book(170692, "Look Out, Secret Seven", 26),
  ], ["Enid Blyton"]);
  assertEquals("book" in picked && picked.book.id, 170692);
});

Deno.test("pickBook refuses ambiguous and thin positions", () => {
  assertEquals(
    pickBook([book(1, "Alpha Tale", 20), book(2, "Beta Story", 10)], [
      "Enid Blyton",
    ]),
    { reason: "ambiguous_book" },
  );
  assertEquals(pickBook([book(1, "Alpha Tale", 3)], ["Enid Blyton"]), {
    reason: "no_book",
  });
});

Deno.test("pickBook drops compilations and other authors", () => {
  const compilation = book(1, "Omnibus", 500, { compilation: true });
  const other = book(2, "Foreign", 500, {
    cached_contributors: [{ author: { name: "Other Author" } }],
  });
  assertEquals(pickBook([compilation, other], ["Enid Blyton"]), {
    reason: "no_book",
  });
  const picked = pickBook([compilation, other, book(3, "Real", 9)], [
    "Enid Blyton",
  ]);
  assertEquals("book" in picked && picked.book.id, 3);
});

const anchor = (number: number, positions: [number, number][], id = 77911) =>
  ({
    simania_id: id,
    number,
    authors: ["Enid Blyton"],
    rows: positions.map(([position, series_id]) => ({ position, series_id })),
  }) as SeriesAnchor;

Deno.test("acceptSeries decisions", () => {
  assertEquals(acceptSeries([anchor(4, [[4, 10178]])]), { series_id: 10178 });
  assertEquals(
    acceptSeries([anchor(4, [[4, 10178]]), anchor(5, [[7, 10178]], 2)]),
    { reason: "anchor_disagrees" },
  );
  assertEquals(acceptSeries([]), { reason: "no_anchor" });
  assertEquals(
    acceptSeries([anchor(4, [[4, 10178], [4, 99]])]),
    { reason: "ambiguous_series" },
  );
});

interface Query {
  text: string;
  values: unknown[];
}

function fakeSql(targets: unknown[]) {
  const queries: Query[] = [];
  const txQueries: Query[] = [];
  const run = (log: Query[]) =>
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    log.push({ text, values });
    if (text.includes("insert into public.works")) {
      return Promise.resolve([{ id: `work-${values[0]}` }]);
    }
    if (text.includes("update public.editions")) {
      return Promise.resolve([{ simania_id: 1 }]);
    }
    if (text.includes("inner join public.works")) {
      return Promise.resolve([{
        simania_id: 77911,
        author: AUTHOR,
        hardcover_id: 213141,
        original_authors: ["Enid Blyton"],
      }]);
    }
    return Promise.resolve(targets);
  };
  const fn = run(queries) as unknown as Record<string, unknown>;
  fn.begin = (cb: (tx: unknown) => unknown) => cb(run(txQueries));
  let ended = 0;
  fn.end = () => {
    ended++;
  };
  return {
    sql: fn as unknown as Sql,
    queries,
    txQueries,
    ended: () => ended,
  };
}

const TARGETS = [
  { simania_id: 60808, title: "ג", author: AUTHOR, series: SERIES },
  { simania_id: 77909, title: "ו", author: AUTHOR, series: SERIES },
  {
    simania_id: 60810,
    title: "יד",
    author: "איניד (אניד) בְּלַייְטוֹן (בליטון)",
    series: SERIES,
  },
];
const NUMBERS: Record<number, string> = {
  60808: "3",
  77909: "6",
  60810: "14",
  77911: "4",
};
const BOOKS: Record<number, SeriesBook[]> = {
  3: [
    book(82054, "Well Done, Secret Seven", 1),
    book(67535, "Well Done, Secret Seven", 36),
  ],
  6: [book(288209, "Good Work, Secret Seven", 22)],
  14: [
    book(2999497, "The Secret Seven", 1),
    book(170692, "Look Out, Secret Seven", 26),
  ],
};

function harness(
  fake: ReturnType<typeof fakeSql>,
  numbers: Record<number, string> = NUMBERS,
) {
  const opens: Array<{ readOnly?: boolean }> = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  let active = 0;
  let maxActive = 0;
  const deps = {
    loadOperatorEnv: () => ({ dbPassword: "unused" }),
    openProdDb: (options?: { readOnly?: boolean }) => {
      opens.push(options ?? {});
      return Promise.resolve(fake.sql);
    },
    bookDetails: (id: number) =>
      Promise.resolve({ id, seriesNumber: numbers[id] }),
    hardcover: async (query: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      requests.push(query);
      await Promise.resolve();
      active--;
      if (query === seriesOfBookQuery(213141)) {
        return { book_series: [{ position: 4, series_id: 10178 }] };
      }
      for (const n of [3, 6, 14]) {
        if (query === booksAtPositionQuery(10178, n)) {
          return {
            book_series: BOOKS[n].map((b) => ({ book_id: b.id, book: b })),
          };
        }
      }
      throw new Error(`unexpected query ${query}`);
    },
    checkHardcoverBudget: () => Promise.resolve(true),
    now: () => new Date("2026-11-21T00:00:00Z"),
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  };
  return { opens, logs, errors, requests, deps, maxActive: () => maxActive };
}

Deno.test("query strings match the contract", () => {
  assertEquals(
    seriesOfBookQuery(5),
    "query { book_series(where:{book_id:{_eq:5}}){ position series_id } }",
  );
  assertEquals(
    booksAtPositionQuery(10178, 3),
    "query { book_series(where:{series_id:{_eq:10178}, position:{_eq:3}}){ book_id book { id title slug users_read_count compilation cached_contributors cached_similar_book_ids cached_tags image { url } } } }",
  );
});

Deno.test("dry run proposes, opens read-only and writes nothing", async () => {
  const fake = fakeSql(TARGETS);
  const h = harness(fake);
  assertEquals(await main([], h.deps), 0);
  assertEquals(h.opens, [{ readOnly: true }]);
  assert(!fake.queries.some((q) => /\b(update|insert) /.test(q.text)));
  assertEquals(fake.txQueries.length, 0);
  assertEquals(h.maxActive(), 1);
  const lines = h.logs.map((l) => JSON.parse(l));
  assertEquals(
    lines.slice(0, 3).map((l) => [l.simania_id, l.proposal.hardcover_id]),
    [[60808, 67535], [77909, 288209], [60810, 170692]],
  );
  assertEquals(lines[0].anchors, [
    { simania_id: 77911, number: 4, position: 4 },
  ]);
  assertEquals(lines[3], { proposals: 3, skipped: 0 });
  assertEquals(fake.ended(), 1);
});

Deno.test("--apply upserts the work and links only null work_id rows", async () => {
  const fake = fakeSql(TARGETS);
  const h = harness(fake);
  assertEquals(await main(["--apply"], h.deps), 0);
  assertEquals(h.opens, [{ readOnly: false }]);
  const updates = fake.txQueries.filter((q) =>
    q.text.includes("update public.editions")
  );
  assertEquals(updates.length, 3);
  for (const u of updates) {
    assert(u.text.includes("work_id is null"));
    assert(u.values.includes("series"));
  }
  assertEquals(
    fake.txQueries.filter((q) => q.text.includes("insert into public.works"))
      .length,
    3,
  );
  assertEquals(JSON.parse(h.logs.at(-1)!), { linked: 3 });
});

Deno.test("a non-numeric seriesNumber is skipped as no_number", async () => {
  const fake = fakeSql([TARGETS[0]]);
  const h = harness(fake, { ...NUMBERS, 60808: "ב" });
  assertEquals(await main([], h.deps), 0);
  const lines = h.logs.map((l) => JSON.parse(l));
  assertEquals(lines[0].reason, "no_number");
  assertEquals(lines[1], { proposals: 0, skipped: 1 });
});

Deno.test("a failed budget check exits 4 without Hardcover requests", async () => {
  const fake = fakeSql(TARGETS);
  const h = harness(fake);
  const code = await main([], {
    ...h.deps,
    checkHardcoverBudget: () => Promise.resolve(false),
  });
  assertEquals(code, 4);
  assertEquals(h.requests.length, 0);
  assertEquals(h.opens.length, 0);
});

Deno.test("bad flags print usage and exit 2", async () => {
  const h = harness(fakeSql([]));
  assertEquals(await main(["--bogus"], h.deps), 2);
  assertEquals(await main(["--simania"], h.deps), 2);
  assert(h.errors[0].startsWith("Usage"));
});

Deno.test("applyRepair defaults to original_title and accepts a status", async () => {
  const plan = {
    kind: "link",
    simania_id: 5,
    book: book(1, "T", 1),
  } as never;
  for (
    const [status, expected] of [
      [undefined, "original_title"],
      ["series", "series"],
    ] as const
  ) {
    const fake = fakeSql([]);
    await applyRepair(fake.sql, plan, new Date(), status);
    const update = fake.txQueries.find((q) =>
      q.text.includes("update public.editions")
    )!;
    assert(update.values.includes(expected));
    assert(!update.text.includes("'original_title'"));
  }
});
