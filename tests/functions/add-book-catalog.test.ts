import { assertEquals } from "jsr:@std/assert@1";
import {
  ensureEdition,
  ensureResolved,
} from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const noBridge = async () => null;

Deno.test("ensureEdition fetches details and rating and upserts display fields", async () => {
  const db = new FakeDb();
  const details = {
    title: "  ספר בדיוק  ",
    author: "מחבר",
    publisher: "מוציא",
    pages: 321,
  };
  const rating = { rating: 4.25, count: 87 };
  const result = await ensureEdition(db, 1234, {
    now: () => NOW,
    bookDetails: async () => details,
    bookRating: async () => rating,
  });
  assertEquals(result.title, "  ספר בדיוק  ");
  assertEquals(result.author, "מחבר");
  assertEquals(result.publisher, "מוציא");
  assertEquals(result.pages, 321);
  assertEquals(result.simania_rating, 4.25);
  assertEquals(result.simania_rating_count, 87);
  assertEquals(result.details_at, NOW.toISOString());
  assertEquals(result.work_id, null);
  assertEquals(result.resolve_status, "pending");
  assertEquals(result.resolved_at, null);
  assertEquals(db.tables.editions.length, 1);
  assertEquals(db.tables.editions[0], result);

  const stored = db.tables.editions[0];
  stored.work_id = "work-keep";
  stored.resolve_status = "wikidata";
  stored.resolved_at = "2026-09-24T10:00:00.000Z";
  stored.details_at = "2026-09-24T10:00:00.000Z";
  stored.title = "ישן";

  const refreshed = await ensureEdition(db, 1234, {
    now: () => NOW,
    bookDetails: async () => details,
    bookRating: async () => rating,
  });
  assertEquals(db.tables.editions.length, 1);
  assertEquals(db.tables.editions[0], refreshed);
  assertEquals(refreshed.title, "  ספר בדיוק  ");
  assertEquals(refreshed.pages, 321);
  assertEquals(refreshed.simania_rating, 4.25);
  assertEquals(refreshed.details_at, NOW.toISOString());
  assertEquals(refreshed.work_id, "work-keep");
  assertEquals(refreshed.resolve_status, "wikidata");
  assertEquals(refreshed.resolved_at, "2026-09-24T10:00:00.000Z");
});

Deno.test("ensureEdition skips providers while details are fresh", async () => {
  const current = edition({ details_at: "2026-10-01T10:00:01.000Z" });
  const db = new FakeDb({ editions: [current] });
  let calls = 0;
  const result = await ensureEdition(db, 1234, {
    now: () => NOW,
    bookDetails: async () => {
      calls++;
      return null;
    },
    bookRating: async () => {
      calls++;
      return null;
    },
  });
  assertEquals(calls, 0);
  assertEquals(result, current);
});

Deno.test("ensureResolved stores a Wikidata Hardcover match", async () => {
  const current = edition() as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const hardcover: HardcoverBook = {
    id: 88,
    title: "Original Title",
    cached_contributors: [{ author: { name: "Author" } }],
    cached_similar_book_ids: [2, 3],
  };
  const result = await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "Original Title",
      author: "Author",
      source: "Wikidata",
    }),
    nliOriginal: noBridge,
    findHardcoverBook: async () => hardcover,
  });
  assertEquals(result.resolve_status, "wikidata");
  assertEquals(result.work_id, "work-1");
  assertEquals(db.tables.works.length, 1);
  assertEquals(db.tables.works[0].id, "work-1");
  assertEquals(db.tables.works[0].hardcover_id, 88);
});

Deno.test("ensureResolved falls back to NLI", async () => {
  const current = edition() as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const searched: string[] = [];
  const result = await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => ({
      title: "NLI Original",
      author: "Author",
      source: "NLI",
    }),
    findHardcoverBook: async (title) => {
      searched.push(title);
      return title === "NLI Original" ? { id: 89, title } : null;
    },
  });
  assertEquals(searched, ["NLI Original"]);
  assertEquals(result.resolve_status, "nli");
});

Deno.test("ensureResolved keeps a recent not_found result cached", async () => {
  const current = edition({
    resolve_status: "not_found",
    resolved_at: "2026-10-20T10:00:00.000Z",
  }) as EditionRow;
  const db = new FakeDb({ editions: [current] });
  let calls = 0;
  const result = await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => {
      calls++;
      return null;
    },
    nliOriginal: async () => {
      calls++;
      return null;
    },
    findHardcoverBook: async () => {
      calls++;
      return null;
    },
  });
  assertEquals(calls, 0);
  assertEquals(result, current);
});

Deno.test("ensureResolved stays pending when a provider fails and nothing matched", async () => {
  const current = edition() as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const result = await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => {
      throw new Error("www.wikidata.org returned 429");
    },
    nliOriginal: noBridge,
    findHardcoverBook: async () => null,
  });
  assertEquals(result.resolve_status, "pending");
  assertEquals(result.resolved_at, null);
  assertEquals(result.work_id, null);
});

Deno.test("ensureResolved stores not_found only when every provider answered", async () => {
  const current = edition() as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const result = await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: noBridge,
    findHardcoverBook: async () => null,
  });
  assertEquals(result.resolve_status, "not_found");
  assertEquals(result.resolved_at, NOW.toISOString());
});
