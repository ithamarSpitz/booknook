import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/search-books/index.ts";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";

Deno.test("search-books rejects an unauthenticated request before searching", async () => {
  let searched = false;
  const handler = createHandler({
    requireUser: async () => {
      throw new HttpError(401, "Authentication required.");
    },
    searchBooks: async () => {
      searched = true;
      return [];
    },
  });
  const response = await handler(
    new Request("http://local/search-books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "ספר" }),
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(searched, false);
});

Deno.test("search-books returns an empty envelope for a short authenticated query", async () => {
  let searched = false;
  const handler = createHandler({
    requireUser: async () => "user-1",
    searchBooks: async () => {
      searched = true;
      return [];
    },
  });
  const response = await handler(
    new Request("http://local/search-books", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test",
      },
      body: JSON.stringify({ query: " א " }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { books: [] });
  assertEquals(searched, false);
});
