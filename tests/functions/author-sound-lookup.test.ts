import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  hebrewAuthorBySound,
  type SearchBooks,
} from "../../supabase/functions/_shared/author-sound.ts";
import type { SimaniaBook } from "../../supabase/functions/_shared/simania.ts";

const stub = (books: SimaniaBook[]): SearchBooks => async () => books;

Deno.test("hebrewAuthorBySound finds Julia Walton without splitting her surname", async () => {
  const result = await hebrewAuthorBySound(
    "Julia Walton",
    stub([
      { id: 1, title: "One", author: "ג'וליה וולטון" },
      { id: 2, title: "Two", author: "ג'וד וולטון" },
    ]),
  );
  assertEquals(result, "ג'וליה וולטון");
});

Deno.test("hebrewAuthorBySound ranks the spelling used on more books", async () => {
  const result = await hebrewAuthorBySound(
    "Stephen King",
    stub([
      { id: 1, title: "One", author: "סטיבן קינג" },
      { id: 2, title: "Two", author: "סטיבן קינג" },
      { id: 3, title: "Three", author: "סטיבן קינג" },
      { id: 4, title: "Four", author: "סטיפן קינג" },
    ]),
  );
  assertEquals(result, "סטיבן קינג");
});

Deno.test("hebrewAuthorBySound rejects a matching surname with another first name", async () => {
  const result = await hebrewAuthorBySound(
    "Veronica Roth",
    stub([{ id: 1, title: "One", author: "בריאן רוט" }]),
  );
  assertEquals(result, null);
});

Deno.test("hebrewAuthorBySound finds an author in a co-author field", async () => {
  const result = await hebrewAuthorBySound(
    "Terry Pratchett",
    stub([{
      id: 1,
      title: "בשורות טובות",
      author: "ניל גיימן וטרי פראצ'ט",
    }]),
  );
  assertEquals(result, "טרי פראצ'ט");
});

Deno.test("hebrewAuthorBySound caps searches and pairs apostrophe forms", async () => {
  const calls: Array<{ query: string; limit: number; offset: number }> = [];
  await hebrewAuthorBySound("Julia Chbosky", async (query, limit, offset) => {
    calls.push({ query, limit, offset });
    return [];
  });

  assertEquals(calls.length <= 26, true);
  assertEquals(calls.every(({ limit }) => limit === 50), true);
  for (
    const { query, offset } of calls.filter(({ query }) => query.includes("'"))
  ) {
    assertEquals(
      calls.some((call) =>
        call.query === query.replace(/'/g, "׳") && call.offset === offset
      ),
      true,
    );
  }
});

Deno.test("hebrewAuthorBySound propagates search failures", async () => {
  await assertRejects(
    () =>
      hebrewAuthorBySound("Stephen King", () => {
        throw new Error("search failed");
      }),
    Error,
    "search failed",
  );
});
