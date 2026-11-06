import { assertEquals } from "jsr:@std/assert@1";
import {
  type LinkProposal,
  type ProposalDeps,
  proposeLink,
} from "../../scripts/lib/link-proposal.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

function pageTitle(title: string): string {
  return `<script type="application/ld+json">${
    JSON.stringify({ "@type": "Book", alternativeHeadline: title })
  }</script>`;
}

function book(
  id: number,
  title: string,
  author?: string,
  usersReadCount = 0,
): HardcoverBook {
  return {
    id,
    title,
    users_read_count: usersReadCount,
    cached_contributors: author === undefined
      ? []
      : [{ author: { name: author } }],
  };
}

function dependencies(options: {
  originalTitle?: string | null;
  englishAuthor?: string | null;
  candidates?: HardcoverBook[];
} = {}): ProposalDeps {
  const originalTitle = options.originalTitle === undefined
    ? "Example Book"
    : options.originalTitle;
  const candidates = options.candidates ?? [];
  return {
    fetchPage: () =>
      Promise.resolve(
        originalTitle === null ? "<html></html>" : pageTitle(originalTitle),
      ),
    wikidataEnglishAuthor: () => Promise.resolve(options.englishAuthor ?? null),
    searchIds: () => Promise.resolve(candidates.map(({ id }) => id)),
    books: () => Promise.resolve(candidates),
  };
}

function summary(result: LinkProposal) {
  return {
    simania_id: result.simania_id,
    original_title: result.original_title,
    english_author: result.english_author,
    book_id: result.book?.id ?? null,
    reason: result.reason,
  };
}

Deno.test("proposeLink selects Under the Dome by its English author", async () => {
  const result = await proposeLink(
    { simania_id: 905132, title: "מתחת לכיפה", author: "סטיבן קינג" },
    dependencies({
      originalTitle: "Under the Dome",
      englishAuthor: "Stephen King",
      candidates: [
        book(384966, "Under the Dome", "Stephen King", 500_000),
        book(999001, "Under the Dome", "Another Writer", 900_000),
      ],
    }),
  );

  assertEquals(summary(result), {
    simania_id: 905132,
    original_title: "Under the Dome",
    english_author: "Stephen King",
    book_id: 384966,
    reason: "ok",
  });
});

Deno.test("proposeLink sound-matches Abby Jimenez without an English author", async () => {
  const candidates = [
    book(1, "Just for the Summer", "Karin N. Mango"),
    book(2, "Just for the Summer", "Laura Van Wormer"),
    book(884117, "Just for the Summer", "Abby Jimenez"),
    book(4, "Just for the Summer", "Judy Astley"),
    book(5, "Just for the Summer", "Melody Carlson"),
    book(6, "Just for the Summer", "Jenna Rutland"),
    book(7, "Just for the Summer", "Sue Moorcroft"),
    book(8, "Just for the Summer"),
  ];
  const result = await proposeLink(
    { simania_id: 1014927, title: "רק לקיץ", author: "אבי חימנז" },
    dependencies({ originalTitle: "Just for the Summer", candidates }),
  );

  assertEquals(result.book?.id, 884117);
  assertEquals(result.reason, "ok");
});

Deno.test("proposeLink rejects a Hebrew original with no page title", async () => {
  const result = await proposeLink(
    { simania_id: 659042, title: "ספר עברי", author: "סופר" },
    dependencies({ originalTitle: null }),
  );

  assertEquals(summary(result), {
    simania_id: 659042,
    original_title: null,
    english_author: null,
    book_id: null,
    reason: "no_original_title",
  });
});

Deno.test("proposeLink rejects multiple sound-matching authors as ambiguous", async () => {
  const result = await proposeLink(
    { simania_id: 42, title: "כותרת", author: "אבי חימנז" },
    dependencies({
      originalTitle: "Exact Title",
      candidates: [
        book(10, "Exact Title", "Abby Jimenez"),
        book(11, "Exact Title", "Abby Jimenez"),
      ],
    }),
  );

  assertEquals(result.book, null);
  assertEquals(result.reason, "ambiguous");
});

Deno.test("proposeLink rejects candidates below the title threshold", async () => {
  const result = await proposeLink(
    { simania_id: 43, title: "כותרת", author: "אבי חימנז" },
    dependencies({
      originalTitle: "Exact Original Title",
      candidates: [book(12, "Entirely Different Book", "Abby Jimenez")],
    }),
  );

  assertEquals(result.book, null);
  assertEquals(result.reason, "no_author_match");
});

Deno.test("proposeLink maps a page fetch failure to provider_error", async () => {
  const deps = dependencies();
  deps.fetchPage = () => Promise.reject(new Error("Simania unavailable"));
  const result = await proposeLink(
    { simania_id: 44, title: "כותרת", author: null },
    deps,
  );

  assertEquals(summary(result), {
    simania_id: 44,
    original_title: null,
    english_author: null,
    book_id: null,
    reason: "provider_error",
  });
});

Deno.test("proposeLink uses Educated's page author and accepts its subtitle", async () => {
  let wikidataCalls = 0;
  const candidates = [
    {
      ...book(44186, "Educated: A Memoir", undefined, 2168),
      cached_contributors: [
        { author: { name: "Tara Westover" } },
        { author: { name: "Julia Whelan" } },
      ],
    },
    book(1018039, "Educated", "Nellie Wilson"),
    book(802966, "Educated", "Sabrina Kade"),
  ];
  const deps = dependencies({
    originalTitle: "Educated / Tara Westover",
    candidates,
  });
  deps.wikidataEnglishAuthor = () => {
    wikidataCalls++;
    return Promise.resolve("Wrong Author");
  };

  const result = await proposeLink(
    { simania_id: 997264, title: "Educated", author: "טארה וסטאובר" },
    deps,
  );

  assertEquals(summary(result), {
    simania_id: 997264,
    original_title: "Educated",
    english_author: "Tara Westover",
    book_id: 44186,
    reason: "ok",
  });
  assertEquals(wikidataCalls, 0);
});

Deno.test("proposeLink uses The Midnight Library's page author", async () => {
  const result = await proposeLink(
    { simania_id: 1002037, title: "ספריית חצות", author: "מאט הייג" },
    dependencies({
      originalTitle: "The Midnight Library / Matt Haig",
      candidates: [book(428018, "The Midnight Library", "Matt Haig")],
    }),
  );

  assertEquals(result.book?.id, 428018);
  assertEquals(result.reason, "ok");
});

Deno.test("proposeLink calls Wikidata when the page has no author", async () => {
  let wikidataCalls = 0;
  const deps = dependencies({
    originalTitle: "Under the Dome",
    candidates: [book(384966, "Under the Dome", "Stephen King")],
  });
  deps.wikidataEnglishAuthor = () => {
    wikidataCalls++;
    return Promise.resolve("Stephen King");
  };

  const result = await proposeLink(
    { simania_id: 905132, title: "מתחת לכיפה", author: "סטיבן קינג" },
    deps,
  );

  assertEquals(result.book?.id, 384966);
  assertEquals(result.english_author, "Stephen King");
  assertEquals(wikidataCalls, 1);
});
