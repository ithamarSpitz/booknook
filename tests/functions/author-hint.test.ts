import { assertEquals } from "jsr:@std/assert@1";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const noBridge = async () => null;

const NLI_BRIDGE = {
  title: "Paris apartment",
  author: "פולי, לוסי",
  source: "NLI" as const,
};

const hardcover: HardcoverBook = {
  id: 463025,
  title: "The Paris Apartment",
  cached_contributors: [{ author: { name: "Lucy Foley" } }],
  cached_similar_book_ids: [],
};

Deno.test("NLI Hardcover match uses English author hint from a linked edition", async () => {
  const resolving = edition({
    simania_id: 1001,
    title: "הדירה בפריז",
    author: "לוסי פולי",
  }) as EditionRow;
  const linked = edition({
    simania_id: 2002,
    title: "רשימת המוזמנים",
    author: "לוסי פולי",
    work_id: "work-foley",
    resolve_status: "nli",
    resolved_at: "2026-10-01T10:00:00.000Z",
  });
  const db = new FakeDb({
    editions: [linked, resolving],
    works: [{
      id: "work-foley",
      hardcover_id: 999,
      original_title: "The Guest List",
      original_authors: ["Lucy Foley"],
      similar_ids: [],
      tags: {},
      hardcover_cover_url: null,
      refreshed_at: null,
    }],
  });

  const calls: { title: string; author: string | null }[] = [];
  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => NLI_BRIDGE,
    findHardcoverBook: async (title, author) => {
      calls.push({ title, author: author ?? null });
      return hardcover;
    },
  });

  assertEquals(calls, [{ title: "Paris apartment", author: "Lucy Foley" }]);
  assertEquals(db.selectCounts.editions, 1);
  assertEquals(db.selectCounts.works, 1);
});

Deno.test("NLI Hardcover match uses NLI creator when no linked edition shares the author", async () => {
  const resolving = edition({
    simania_id: 1001,
    title: "הדירה בפריז",
    author: "לוסי פולי",
  }) as EditionRow;
  const db = new FakeDb({ editions: [resolving] });

  const calls: { title: string; author: string | null }[] = [];
  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => NLI_BRIDGE,
    findHardcoverBook: async (title, author) => {
      calls.push({ title, author: author ?? null });
      return hardcover;
    },
  });

  assertEquals(calls, [{ title: "Paris apartment", author: "פולי, לוסי" }]);
});

Deno.test("English author hint ignores other authors and editions without work_id", async () => {
  const resolving = edition({
    simania_id: 1001,
    title: "הדירה בפריז",
    author: "לוסי פולי",
  }) as EditionRow;
  const db = new FakeDb({
    editions: [
      resolving,
      edition({
        simania_id: 2002,
        title: "רשימת המוזמנים",
        author: "לוסי פולי",
        work_id: null,
        resolved_at: "2026-10-20T10:00:00.000Z",
      }),
      edition({
        simania_id: 3003,
        title: "ספר אחר",
        author: "מחבר אחר",
        work_id: "work-other",
        resolve_status: "wikidata",
        resolved_at: "2026-10-22T10:00:00.000Z",
      }),
    ],
    works: [{
      id: "work-other",
      hardcover_id: 1,
      original_title: "Other",
      original_authors: ["Someone Else"],
      similar_ids: [],
      tags: {},
      hardcover_cover_url: null,
      refreshed_at: null,
    }],
  });

  const calls: { title: string; author: string | null }[] = [];
  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => NLI_BRIDGE,
    findHardcoverBook: async (title, author) => {
      calls.push({ title, author: author ?? null });
      return hardcover;
    },
  });

  assertEquals(calls, [{ title: "Paris apartment", author: "פולי, לוסי" }]);
});

Deno.test("Wikidata path does not read the catalog for an English author hint", async () => {
  const resolving = edition({
    simania_id: 1001,
    title: "הדירה בפריז",
    author: "לוסי פולי",
  }) as EditionRow;
  const db = new FakeDb({
    editions: [
      resolving,
      edition({
        simania_id: 2002,
        title: "רשימת המוזמנים",
        author: "לוסי פולי",
        work_id: "work-foley",
        resolve_status: "nli",
        resolved_at: "2026-10-01T10:00:00.000Z",
      }),
    ],
    works: [{
      id: "work-foley",
      hardcover_id: 999,
      original_title: "The Guest List",
      original_authors: ["Lucy Foley"],
      similar_ids: [],
      tags: {},
      hardcover_cover_url: null,
      refreshed_at: null,
    }],
  });

  const calls: { title: string; author: string | null }[] = [];
  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "The Paris Apartment",
      author: "Lucy Foley",
      source: "Wikidata",
    }),
    nliOriginal: async () => {
      throw new Error("NLI should not run");
    },
    findHardcoverBook: async (title, author) => {
      calls.push({ title, author: author ?? null });
      return hardcover;
    },
  });

  assertEquals(calls, [{
    title: "The Paris Apartment",
    author: "Lucy Foley",
  }]);
  assertEquals(db.selectCounts.editions ?? 0, 0);
  assertEquals(db.selectCounts.works ?? 0, 0);
});
