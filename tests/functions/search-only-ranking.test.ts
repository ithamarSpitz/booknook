import { assertEquals } from "jsr:@std/assert@1";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import {
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-11-21T10:00:00.000Z");

const docs = [
  { id: "1", title: "Peter Pan", users_read_count: 100, author: "J. M. Barrie" },
  { id: "2", title: "Peter Pan", users_read_count: 9000, author: "J. M. Barrie" },
  { id: "3", title: "Peter Pan and Wendy", users_read_count: 50000, author: "J. M. Barrie" },
].map((d) => ({
  document: {
    id: d.id,
    title: d.title,
    slug: `slug-${d.id}`,
    users_read_count: d.users_read_count,
    contributions: [{ author: { name: d.author } }],
    image: { url: `https://img/${d.id}.jpg` },
  },
}));

const detailBooks: HardcoverBook[] = docs.map(({ document: d }) => ({
  id: Number(d.id),
  title: d.title,
  users_read_count: d.users_read_count,
  cached_contributors: d.contributions,
  cached_similar_book_ids: [7],
}));

function stub(hits: unknown[], ids: number[]) {
  const original = globalThis.fetch;
  const counter = { books: 0 };
  globalThis.fetch = (_input, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("search(")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { search: { ids, results: { hits } } } }),
          { status: 200 },
        ),
      );
    }
    if (query.includes("books(")) {
      counter.books += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ data: { books: detailBooks } }), { status: 200 }),
      );
    }
    return Promise.reject(new Error(`unexpected query ${query}`));
  };
  return { counter, restore: () => (globalThis.fetch = original) };
}

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prior = Deno.env.get("HARDCOVER_API_KEY");
  Deno.env.set("HARDCOVER_API_KEY", "test");
  try {
    return await fn();
  } finally {
    if (prior === undefined) Deno.env.delete("HARDCOVER_API_KEY");
    else Deno.env.set("HARDCOVER_API_KEY", prior);
  }
}

Deno.test("search documents rank without a books request", async () => {
  const s = stub(docs, [1, 2, 3]);
  try {
    const book = await withKey(() => findHardcoverBook("Peter Pan", "J. M. Barrie"));
    assertEquals(book?.id, 2);
    assertEquals(book?.cached_similar_book_ids, undefined);
    assertEquals(book?.cached_contributors, [{ author: { name: "J. M. Barrie" } }]);
    assertEquals(book?.slug, "slug-2");
    assertEquals(s.counter.books, 0);
  } finally {
    s.restore();
  }
});

Deno.test("a missing document falls back to one books request", async () => {
  const s = stub(docs.slice(0, 2), [1, 2, 3]);
  try {
    const book = await withKey(() => findHardcoverBook("Peter Pan", "J. M. Barrie"));
    assertEquals(book?.id, 2);
    assertEquals(s.counter.books, 1);
  } finally {
    s.restore();
  }
});

const matchFromDocs: HardcoverBook = {
  id: 2,
  title: "Peter Pan",
  cached_contributors: [{ author: { name: "J. M. Barrie" } }],
};

// The match comes from the real search path over stubbed search documents.
async function run(
  hardcoverBooks: (ids: number[]) => Promise<HardcoverBook[]>,
  fromDocuments = true,
  book: HardcoverBook = matchFromDocs,
) {
  const current = edition({ author: "J. M. Barrie" }) as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const s = stub(docs, [1, 2, 3]);
  try {
    const result = await withKey(() =>
      ensureResolved(db, current, {
        now: () => NOW,
        wikidataOriginal: async () => ({ title: "Peter Pan", author: "J. M. Barrie", source: "Wikidata" as const }),
        nliOriginal: async () => null,
        findHardcoverBook: fromDocuments
          ? (title, author, options) => findHardcoverBook(title, author, options)
          : async () => book,
        hardcoverBooks,
      })
    );
    return { db, result, searchBooks: s.counter.books };
  } finally {
    s.restore();
  }
}

Deno.test("ensureResolved fetches details once for a document match", async () => {
  let calls = 0;
  const { db, result, searchBooks } = await run(async (ids) => {
    calls += 1;
    assertEquals(ids, [2]);
    return [{ ...matchFromDocs, cached_similar_book_ids: [1, 2] }];
  });
  assertEquals(calls, 1);
  assertEquals(searchBooks, 0);
  assertEquals(result.resolve_status, "wikidata");
  assertEquals(db.tables.works.length, 1);
  assertEquals(db.tables.works[0].similar_ids, [1, 2]);
});

Deno.test("details failure leaves the edition pending with no work", async () => {
  const { db, result } = await run(async () => {
    throw new Error("down");
  });
  assertEquals(result.resolve_status, "pending");
  assertEquals(result.work_id, null);
  assertEquals(db.tables.works?.length ?? 0, 0);
});

Deno.test("details returning no book leaves the edition pending with no work", async () => {
  const { db, result } = await run(async () => []);
  assertEquals(result.resolve_status, "pending");
  assertEquals(db.tables.works?.length ?? 0, 0);
});

Deno.test("a match with similar ids skips the details request", async () => {
  let calls = 0;
  const { db } = await run(async () => {
    calls += 1;
    return [];
  }, false, { ...matchFromDocs, cached_similar_book_ids: [5] });
  assertEquals(calls, 0);
  assertEquals(db.tables.works[0].similar_ids, [5]);
});
