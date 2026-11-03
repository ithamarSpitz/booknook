import { assertEquals } from "jsr:@std/assert@1";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";
import { createHandler } from "../../supabase/functions/search-english/index.ts";

function request(body: unknown) {
  return new Request("http://local/search-english", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("search-english returns books from the injected search", async () => {
  const books = [{
    hardcover_id: 383752,
    title: "Spin",
    author: "Robert Charles Wilson",
    year: 2005,
    cover_url: "https://example.test/spin.jpg",
  }];
  const queries: string[] = [];
  const handler = createHandler({
    requireUser: async () => "user-1",
    searchEnglish: async (query) => {
      queries.push(query);
      return books;
    },
  });

  const response = await handler(request({ query: " spin " }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { books });
  assertEquals(queries, [" spin "]);
});

Deno.test("search-english rejects missing and non-string queries", async () => {
  const handler = createHandler({
    requireUser: async () => "user-1",
    searchEnglish: async () => [],
  });

  assertEquals((await handler(request({}))).status, 400);
  assertEquals((await handler(request({ query: 123 }))).status, 400);
  assertEquals((await handler(request(null))).status, 400);
});

Deno.test("search-english requires authentication", async () => {
  const handler = createHandler({
    requireUser: async () => {
      throw new HttpError(401, "Authentication required.");
    },
    searchEnglish: async () => [],
  });

  assertEquals((await handler(request({ query: "spin" }))).status, 401);
});

Deno.test("search-english maps search failures to 502", async () => {
  const handler = createHandler({
    requireUser: async () => "user-1",
    searchEnglish: async () => {
      throw new Error("provider down");
    },
  });

  const response = await handler(request({ query: "spin" }));
  assertEquals(response.status, 502);
  assertEquals(await response.json(), { error: "Hardcover request failed." });
});
