import { assertEquals } from "jsr:@std/assert@1";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");

type HcCall = { title: string; author: string; options: unknown };

function setup(overrides: Record<string, unknown>) {
  const current = edition(overrides) as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const hcCalls: HcCall[] = [];
  const nliCalls: string[] = [];
  return { current, db, hcCalls, nliCalls };
}

Deno.test("Wikidata bridge match retries with author", async () => {
  const { current, db, hcCalls } = setup({ title: "פרא", author: "שטרייד, שריל" });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => ({
      title: "Wild",
      author: "Cheryl Strayed",
      source: "Wikidata",
    }),
    nliOriginal: async () => null,
    findHardcoverBook: async (title, author = "", options) => {
      hcCalls.push({ title, author, options });
      return { id: 1, title: "Wild" } as HardcoverBook;
    },
  });
  assertEquals(hcCalls[0], {
    title: "Wild",
    author: "Cheryl Strayed",
    options: { retryWithAuthor: true },
  });
});

Deno.test("NLI bridge without hint passes soundAuthor", async () => {
  const { current, db, hcCalls } = setup({ title: "שרוד", author: "אלכס מורל" });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async () => ({
      title: "Survive",
      author: "מורל, אלכס",
      source: "NLI",
    }),
    wikidataEnglishAuthor: async () => null,
    findHardcoverBook: async (title, author = "", options) => {
      hcCalls.push({ title, author, options });
      return null;
    },
  });
  assertEquals(hcCalls[0], {
    title: "Survive",
    author: "מורל, אלכס",
    options: { retryWithAuthor: true, soundAuthor: "אלכס מורל" },
  });
});

Deno.test("NLI bridge with versoAuthor has no soundAuthor", async () => {
  const { current, db, hcCalls } = setup({ title: "שרוד", author: "אלכס מורל" });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async () => ({
      title: "Survive",
      author: "מורל, אלכס",
      versoAuthor: "Alex Morel",
      source: "NLI",
    }),
    wikidataEnglishAuthor: async () => null,
    findHardcoverBook: async (title, author = "", options) => {
      hcCalls.push({ title, author, options });
      return null;
    },
  });
  assertEquals(hcCalls[0], {
    title: "Survive",
    author: "Alex Morel",
    options: { retryWithAuthor: true },
  });
});

Deno.test("fuzzy call keeps exactly requireAuthor", async () => {
  const { current, db, hcCalls } = setup({ title: "ספר", author: "סופר" });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async () => null,
    findHardcoverBook: async (title, author = "", options) => {
      hcCalls.push({ title, author, options });
      return null;
    },
  });
  assertEquals(hcCalls.map((c) => c.options), [{ requireAuthor: true }]);
});

Deno.test("series prefix retries NLI with the rest of the title", async () => {
  const { current, db, hcCalls, nliCalls } = setup({
    title: "הגן הכימי - הקמילה",
    author: "לורן דוגרי",
    series: "הגן הכימי ",
  });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async (title: string) => {
      nliCalls.push(title);
      return title === "הקמילה"
        ? { title: "Wither", author: "דוגרי, לורן", source: "NLI" }
        : null;
    },
    wikidataEnglishAuthor: async () => null,
    findHardcoverBook: async (title, author = "", options) => {
      hcCalls.push({ title, author, options });
      return null;
    },
  });
  assertEquals(nliCalls, ["הגן הכימי - הקמילה", "הקמילה"]);
  assertEquals(hcCalls[0].title, "Wither");
});

Deno.test("series prefix with volume marker does not retry", async () => {
  const { current, db, nliCalls } = setup({
    title: "יומני רובורצח - כרך 1",
    series: "יומני רובורצח",
  });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async (title: string) => {
      nliCalls.push(title);
      return null;
    },
    findHardcoverBook: async () => null,
  });
  assertEquals(nliCalls.length, 1);
});

Deno.test("full-title NLI hit does not retry", async () => {
  const { current, db, nliCalls } = setup({
    title: "הגן הכימי - הקמילה",
    series: "הגן הכימי",
  });
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async (title: string) => {
      nliCalls.push(title);
      return { title: "Wither", author: "דוגרי, לורן", source: "NLI" };
    },
    wikidataEnglishAuthor: async () => null,
    findHardcoverBook: async () => null,
  });
  assertEquals(nliCalls.length, 1);
});

for (const series of [null, "", "  "]) {
  Deno.test(`null or empty series (${JSON.stringify(series)}) does not retry`, async () => {
    const { current, db, nliCalls } = setup({
      title: "הגן הכימי - הקמילה",
      series,
    });
    await ensureResolved(db, current, {
      now: () => NOW,
      wikidataOriginal: async () => null,
      nliOriginal: async (title: string) => {
        nliCalls.push(title);
        return null;
      },
      findHardcoverBook: async () => null,
    });
    assertEquals(nliCalls.length, 1);
  });
}
