import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  englishEditionFields,
  englishEditionId,
  ensureEnglishEdition,
  htmlToText,
  isEnglishEdition,
  searchEnglish,
} from "../../supabase/functions/_shared/english.ts";
import type { HardcoverEnglishBook } from "../../supabase/functions/_shared/hardcover.ts";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-11-02T10:00:00.000Z");

function spin(
  overrides: Partial<HardcoverEnglishBook> = {},
): HardcoverEnglishBook {
  return {
    id: 383752,
    title: "Spin",
    cached_contributors: [{ author: { name: "Robert Charles Wilson" } }],
    cached_similar_book_ids: [1, 2],
    cached_tags: { Genre: [{ tag: "Science Fiction" }] },
    image: { url: "https://example.test/spin.jpg" },
    description: "<p>A novel.</p>",
    rating: 4.236,
    ratings_count: 4321,
    pages: null,
    release_year: 2005,
    default_physical_edition: {
      pages: 458,
      publisher: { name: "Tor Books" },
    },
    ...overrides,
  };
}

Deno.test("English edition ID helpers use negative Hardcover IDs", () => {
  assertEquals(englishEditionId(383752), -383752);
  assertEquals(isEnglishEdition(-383752), true);
  assertEquals(isEnglishEdition(383752), false);
});

Deno.test("htmlToText preserves paragraph breaks and decodes entities", () => {
  assertEquals(
    htmlToText(
      "<p><b>Now in&hellip;</b><br><br>One night&nbsp;&amp; day&#8230;</p>",
    ),
    "Now in…\n\nOne night\u00a0& day…",
  );
  assertEquals(
    htmlToText("<p>Fran&ccedil;ois &copy; 2026 &euro;10</p>"),
    "François © 2026 €10",
  );
  assertEquals(htmlToText("<p><br></p>"), null);
});

Deno.test("englishEditionFields maps display fields and nullable fallbacks", () => {
  assertEquals(
    englishEditionFields(spin({
      cached_contributors: [
        { author: { name: "Robert Charles Wilson" } },
        { author: { name: "Another Author" } },
      ],
    })),
    {
      title: "Spin",
      author: "Robert Charles Wilson, Another Author",
      translator: null,
      publisher: "Tor Books",
      series: null,
      category: null,
      year: 2005,
      pages: 458,
      description: "A novel.",
      cover_url: "https://example.test/spin.jpg",
      simania_rating: 4.24,
      simania_rating_count: 4321,
    },
  );
  const missing = englishEditionFields(spin({
    cached_contributors: [],
    image: null,
    description: null,
    rating: null,
    ratings_count: null,
    release_year: null,
    default_physical_edition: null,
  }));
  assertEquals(missing.author, null);
  assertEquals(missing.publisher, null);
  assertEquals(missing.pages, null);
  assertEquals(missing.simania_rating, null);
});

Deno.test("englishEditionFields rounds decimal rating midpoints up", () => {
  for (const [rating, expected] of [
    [4.225, 4.23],
    [1.005, 1.01],
    [4.015, 4.02],
    [4.2249, 4.22],
    [4.2251, 4.23],
    [0, 0],
    [5, 5],
    [1e-7, 0],
  ]) {
    assertEquals(englishEditionFields(spin({ rating })).simania_rating, expected);
  }
});

Deno.test("ensureEnglishEdition creates a linked work and Hardcover edition", async () => {
  const db = new FakeDb();
  const result = await ensureEnglishEdition(db, 383752, {
    hardcoverEnglishBooks: async () => [spin()],
  }, NOW);
  assertEquals(result.simania_id, -383752);
  assertEquals(result.work_id, "work-1");
  assertEquals(result.resolve_status, "hardcover");
  assertEquals(result.resolved_at, NOW.toISOString());
  assertEquals(result.details_at, NOW.toISOString());
  assertEquals(db.tables.works[0], {
    id: "work-1",
    hardcover_id: 383752,
    original_title: "Spin",
    original_authors: ["Robert Charles Wilson"],
    similar_ids: [1, 2],
    tags: { Genre: [{ tag: "Science Fiction" }] },
    hardcover_cover_url: "https://example.test/spin.jpg",
    refreshed_at: NOW.toISOString(),
  });
});

Deno.test("ensureEnglishEdition reuses fresh rows and refreshes 31-day-old rows", async () => {
  const freshRow = edition({
    simania_id: -383752,
    work_id: "work-old",
    resolve_status: "hardcover",
    title: "Cached Spin",
    details_at: new Date(NOW.getTime() - 29 * 86_400_000).toISOString(),
  });
  const freshDb = new FakeDb({ editions: [freshRow] });
  let calls = 0;
  const provider = async () => {
    calls += 1;
    return [spin()];
  };
  assertEquals(
    (await ensureEnglishEdition(freshDb, 383752, {
      hardcoverEnglishBooks: provider,
    }, NOW)).title,
    "Cached Spin",
  );
  assertEquals(calls, 0);

  const staleRow = {
    ...freshRow,
    details_at: new Date(NOW.getTime() - 31 * 86_400_000).toISOString(),
  };
  const staleDb = new FakeDb({ editions: [staleRow] });
  const refreshed = await ensureEnglishEdition(staleDb, 383752, {
    hardcoverEnglishBooks: provider,
  }, NOW);
  assertEquals(calls, 1);
  assertEquals(refreshed.title, "Spin");
  assertEquals(refreshed.details_at, NOW.toISOString());
});

Deno.test("ensureEnglishEdition reports an unknown Hardcover ID as 404", async () => {
  const error = await assertRejects(
    () =>
      ensureEnglishEdition(new FakeDb(), 999, {
        hardcoverEnglishBooks: async () => [],
      }, NOW),
    HttpError,
    "Book not found on Hardcover.",
  );
  assertEquals(error.status, 404);
});

Deno.test("English providers failures are reported as 502", async () => {
  const ensureError = await assertRejects(
    () =>
      ensureEnglishEdition(new FakeDb(), 383752, {
        hardcoverEnglishBooks: () => Promise.reject(new Error("offline")),
      }, NOW),
    HttpError,
    "Hardcover request failed.",
  );
  assertEquals(ensureError.status, 502);

  const searchError = await assertRejects(
    () =>
      searchEnglish("spin", {
        searchHardcoverBooks: () => Promise.reject(new Error("offline")),
      }),
    HttpError,
    "Hardcover request failed.",
  );
  assertEquals(searchError.status, 502);
});

Deno.test("searchEnglish skips short queries and preserves Hardcover search order", async () => {
  let searchCalls = 0;
  let batchCalls = 0;
  const deps = {
    searchHardcoverBooks: async (_query: string) => {
      searchCalls += 1;
      return [2, 1];
    },
    hardcoverEnglishBooks: async (_ids: number[]) => {
      batchCalls += 1;
      return [
        spin({ id: 1, title: "First" }),
        spin({ id: 2, title: "Second" }),
      ];
    },
  };
  assertEquals(await searchEnglish(" x ", deps), []);
  assertEquals(searchCalls, 0);
  assertEquals(batchCalls, 0);
  assertEquals(await searchEnglish(" spin ", deps), [
    {
      hardcover_id: 2,
      title: "Second",
      author: "Robert Charles Wilson",
      year: 2005,
      cover_url: "https://example.test/spin.jpg",
    },
    {
      hardcover_id: 1,
      title: "First",
      author: "Robert Charles Wilson",
      year: 2005,
      cover_url: "https://example.test/spin.jpg",
    },
  ]);
  assertEquals(searchCalls, 1);
  assertEquals(batchCalls, 1);
});
