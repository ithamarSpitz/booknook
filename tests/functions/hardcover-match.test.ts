import { assertEquals } from "jsr:@std/assert@1";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import {
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");

const auroraBooks: HardcoverBook[] = [
  {
    id: 372879,
    title: "Aurora",
    users_read_count: 50_000,
    cached_contributors: [{ author: { name: "Kim Stanley Robinson" } }],
  },
  {
    id: 559469,
    title: "Aurora",
    users_read_count: 200,
    cached_contributors: [{ author: { name: "David Koepp" } }],
  },
];

const parisBooks: HardcoverBook[] = [
  {
    id: 601,
    title: "The Paris Apartment",
    users_read_count: 40_000,
    cached_contributors: [{ author: { name: "Lucy Foley" } }],
  },
  {
    id: 602,
    title: "The Paris Apartment",
    users_read_count: 35_000,
    cached_contributors: [{ author: { name: "Alex Michaelides" } }],
  },
  {
    id: 603,
    title: "The Paris Apartment",
    users_read_count: 30_000,
    cached_contributors: [{ author: { name: "Lisa Jewell" } }],
  },
  {
    id: 604,
    title: "The Paris Apartment",
    users_read_count: 25_000,
    cached_contributors: [{ author: { name: "Ruth Ware" } }],
  },
];

const hebrewAmbiguousBooks: HardcoverBook[] = [
  {
    id: 483014,
    title: "נערה, מופרעת",
    users_read_count: 10_000,
    cached_contributors: [{ author: { name: "Susanna Kaysen" } }],
  },
  {
    id: 473787,
    title: "נערה בנוף",
    users_read_count: 500,
    cached_contributors: [{ author: { name: "Jonathan Lethem" } }],
  },
];

function stubHardcover(books: HardcoverBook[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const query = body.query as string;
    if (query.includes("search(")) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { search: { ids: books.map((book) => book.id) } },
      }), { status: 200 }));
    }
    if (query.includes("books(")) {
      return Promise.resolve(new Response(JSON.stringify({ data: { books } }), {
        status: 200,
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: {} }), {
      status: 200,
    }));
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("findHardcoverBook rejects same-title Aurora tie without author boost", async () => {
  Deno.env.set("HARDCOVER_API_KEY", "test-token");
  const restoreFetch = stubHardcover(auroraBooks);
  try {
    const result = await findHardcoverBook("Aurora", "קופ, דוד");
    assertEquals(result, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("findHardcoverBook picks David Koepp Aurora with English author hint", async () => {
  Deno.env.set("HARDCOVER_API_KEY", "test-token");
  const restoreFetch = stubHardcover(auroraBooks);
  try {
    const result = await findHardcoverBook("Aurora", "David Koepp");
    assertEquals(result?.id, 559469);
  } finally {
    restoreFetch();
  }
});

Deno.test("findHardcoverBook picks Lucy Foley among four Paris Apartment titles", async () => {
  Deno.env.set("HARDCOVER_API_KEY", "test-token");
  const restoreFetch = stubHardcover(parisBooks);
  try {
    const result = await findHardcoverBook("Paris apartment", "Lucy Foley");
    assertEquals(result?.id, 601);
  } finally {
    restoreFetch();
  }
});

Deno.test("findHardcoverBook accepts a lone match without author boost", async () => {
  Deno.env.set("HARDCOVER_API_KEY", "test-token");
  const lone: HardcoverBook[] = [{
    id: 9001,
    title: "Only Match",
    users_read_count: 12,
    cached_contributors: [{ author: { name: "Someone Else" } }],
  }];
  const restoreFetch = stubHardcover(lone);
  try {
    const result = await findHardcoverBook("Only Match", "");
    assertEquals(result?.id, 9001);
  } finally {
    restoreFetch();
  }
});

Deno.test("findHardcoverBook requireAuthor rejects Hebrew title without author evidence", async () => {
  Deno.env.set("HARDCOVER_API_KEY", "test-token");
  const restoreFetch = stubHardcover(hebrewAmbiguousBooks);
  try {
    const result = await findHardcoverBook(
      "נערה בנוף",
      "ג'ונתן לת'ם",
      { requireAuthor: true },
    );
    assertEquals(result, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("ensureResolved passes requireAuthor on direct fuzzy Hardcover match", async () => {
  const current = edition() as EditionRow;
  const db = new FakeDb({ editions: [current] });
  const fuzzyCalls: Array<
    { title: string; author: string; options?: { requireAuthor?: boolean } }
  > = [];
  await ensureResolved(db, current, {
    now: () => NOW,
    wikidataOriginal: async () => null,
    nliOriginal: async () => null,
    findHardcoverBook: async (title, author = "", options) => {
      fuzzyCalls.push({ title, author, options });
      return null;
    },
  });
  assertEquals(fuzzyCalls, [{
    title: "ספר",
    author: "סופר",
    options: { requireAuthor: true },
  }]);
});
