import { assertEquals } from "jsr:@std/assert@1";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const noBridge = async () => null;
const noWikidataAuthor = async () => null;

const NLI_BRIDGE = {
  title: "Paris apartment",
  author: "פולי, לוסי",
  source: "NLI" as const,
};

const AURORA_NLI = {
  title: "Aurora",
  author: "קופ, דיוויד",
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
    wikidataEnglishAuthor: async () => {
      throw new Error("wikidataEnglishAuthor should not run when catalog hint exists");
    },
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
    wikidataEnglishAuthor: noWikidataAuthor,
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
    wikidataEnglishAuthor: noWikidataAuthor,
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
    wikidataEnglishAuthor: async () => {
      throw new Error("wikidataEnglishAuthor should not run on Wikidata path");
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

Deno.test("NLI Hardcover match uses Wikidata English author when catalog hint is missing", async () => {
  const resolving = edition({
    simania_id: 5005,
    title: "כיבוי אורות",
    author: "דיוויד קופ",
  }) as EditionRow;
  const db = new FakeDb({ editions: [resolving] });

  const wikidataAuthorCalls: string[] = [];
  const calls: { title: string; author: string | null }[] = [];
  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => AURORA_NLI,
    wikidataEnglishAuthor: async (name) => {
      wikidataAuthorCalls.push(name);
      return "David Koepp";
    },
    findHardcoverBook: async (title, author) => {
      calls.push({ title, author: author ?? null });
      return title === "Aurora"
        ? { id: 559469, title: "Aurora", cached_contributors: [{ author: { name: "David Koepp" } }], cached_similar_book_ids: [] }
        : null;
    },
  });

  assertEquals(wikidataAuthorCalls, ["דיוויד קופ"]);
  assertEquals(calls, [{ title: "Aurora", author: "David Koepp" }]);
});

Deno.test("NLI path falls back to NLI creator when catalog and Wikidata author hints are missing", async () => {
  const resolving = edition({
    simania_id: 1001,
    title: "הדירה בפריז",
    author: "לוסי פולי",
  }) as EditionRow;
  const db = new FakeDb({ editions: [resolving] });

  const wikidataAuthorCalls: string[] = [];
  const calls: { title: string; author: string | null }[] = [];
  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => NLI_BRIDGE,
    wikidataEnglishAuthor: async (name) => {
      wikidataAuthorCalls.push(name);
      return null;
    },
    findHardcoverBook: async (title, author) => {
      calls.push({ title, author: author ?? null });
      return hardcover;
    },
  });

  assertEquals(wikidataAuthorCalls, ["לוסי פולי"]);
  assertEquals(calls, [{ title: "Paris apartment", author: "פולי, לוסי" }]);
});

Deno.test("Wikidata and fuzzy resolve paths never call wikidataEnglishAuthor", async () => {
  const resolving = edition({
    simania_id: 6006,
    title: "נערה בנוף",
    author: "ג'ונתן לת'ם",
  }) as EditionRow;
  const db = new FakeDb({ editions: [resolving] });

  const wikidataAuthorCalls: string[] = [];
  const rejectAuthorBridge = async (name: string) => {
    wikidataAuthorCalls.push(name);
    throw new Error("wikidataEnglishAuthor should not run");
  };

  await ensureResolved(db, resolving, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "Some Title",
      author: "English Author",
      source: "Wikidata",
    }),
    nliOriginal: async () => null,
    wikidataEnglishAuthor: rejectAuthorBridge,
    findHardcoverBook: async (title) => {
      return title === "Some Title"
        ? { id: 1, title: "Some Title", cached_contributors: [{ author: { name: "English Author" } }], cached_similar_book_ids: [] }
        : null;
    },
  });
  assertEquals(wikidataAuthorCalls, []);

  wikidataAuthorCalls.length = 0;
  const fuzzyResolving = edition({
    simania_id: 6007,
    title: "נערה בנוף",
    author: "ג'ונתן לת'ם",
  }) as EditionRow;
  const fuzzyDb = new FakeDb({ editions: [fuzzyResolving] });

  await ensureResolved(fuzzyDb, fuzzyResolving, {
    now: () => NOW,
    wikidataOriginal: noBridge,
    nliOriginal: async () => null,
    wikidataEnglishAuthor: rejectAuthorBridge,
    findHardcoverBook: async (title, _author, options) => {
      return options?.requireAuthor
        ? { id: 2, title, cached_contributors: [{ author: { name: "Susanna Kaysen" } }], cached_similar_book_ids: [] }
        : null;
    },
  });
  assertEquals(wikidataAuthorCalls, []);
});
