import { assertEquals } from "jsr:@std/assert@1";
import {
  authorBoost,
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";

function book(id: number, title: string, author: string, readers = 1): HardcoverBook {
  return {
    id,
    title,
    users_read_count: readers,
    cached_contributors: [{ author: { name: author } }],
  };
}

function stubHardcover(resultsByQuery: Record<string, HardcoverBook[]>) {
  const originalFetch = globalThis.fetch;
  const allBooks = new Map(
    Object.values(resultsByQuery).flat().map((entry) => [entry.id, entry]),
  );
  globalThis.fetch = (_input, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("search(")) {
      const text = query.match(/search\(query: "([^"]*)"/)?.[1] ?? "";
      const ids = (resultsByQuery[text] ?? []).map((entry) => entry.id);
      return Promise.resolve(Response.json({ data: { search: { ids } } }));
    }
    if (query.includes("books(")) {
      const encodedIds = query.match(/id:\{_in:(\[[^\]]*\])\}/)?.[1] ?? "[]";
      const books = (JSON.parse(encodedIds) as number[])
        .map((id) => allBooks.get(id))
        .filter((entry): entry is HardcoverBook => entry !== undefined);
      return Promise.resolve(Response.json({ data: { books } }));
    }
    return Promise.resolve(Response.json({ data: {} }));
  };
  return { restore: () => (globalThis.fetch = originalFetch) };
}

Deno.env.set("HARDCOVER_API_KEY", "test-token");

Deno.test("retry matches an author written with or without dotted initials", async () => {
  const stub = stubHardcover({
    "Night school": [
      book(1, "Night School", "Other Writer", 50),
      book(2, "Night School", "Another Person", 40),
    ],
    "Night school CJ Daugherty": [book(61420, "Night School", "C.J. Daugherty", 73)],
  });
  try {
    const result = await findHardcoverBook("Night school", "CJ Daugherty", {
      retryWithAuthor: true,
    });
    assertEquals(result?.id, 61420);
  } finally {
    stub.restore();
  }
});

Deno.test("initials boost however they are written", () => {
  for (
    const [hint, name] of [
      ["J.K. Rowling", "J. K. Rowling"],
      ["JRR Tolkien", "J.R.R. Tolkien"],
    ]
  ) {
    assertEquals(authorBoost(hint, "", book(1, "T", name)), 2, `${hint} / ${name}`);
  }
});

Deno.test("different authors do not boost", () => {
  assertEquals(authorBoost("CJ Daugherty", "", book(1, "T", "Christopher Paolini")), 0);
});
