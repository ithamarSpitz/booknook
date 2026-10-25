import { assertEquals } from "jsr:@std/assert@1";
import {
  bookDetails,
  bookRating,
} from "../../supabase/functions/_shared/simania.ts";

Deno.test("Simania details and rating use the documented MCP tools without live network", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  const detailsFixture = JSON.stringify(JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/simania/book-details.json", import.meta.url),
    ),
  ));
  const ratingFixture = JSON.stringify(JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/simania/book-rating.json", import.meta.url),
    ),
  ));
  globalThis.fetch = (_input, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(request);
    const params = request.params as { name: string };
    const fixture = params.name === "books_get_details"
      ? detailsFixture
      : ratingFixture;
    return Promise.resolve(
      new Response(`data: ${fixture}\n`, { status: 200 }),
    );
  };
  try {
    assertEquals((await bookDetails(1234))?.title, "יונה ונער");
    assertEquals(await bookRating(1234), {
      averageRating: 4.3362,
      ratingCount: 827,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(
    calls.map((call) => {
      const params = call.params as { name: string; arguments: unknown };
      return { name: params.name, arguments: params.arguments };
    }),
    [
      { name: "books_get_details", arguments: { bookId: 1234 } },
      { name: "books_get_rating", arguments: { bookId: 1234 } },
    ],
  );
});
