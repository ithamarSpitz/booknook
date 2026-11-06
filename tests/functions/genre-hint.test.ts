import { assertEquals } from "jsr:@std/assert@1";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";
import { createHandler } from "../../supabase/functions/genre-hint/index.ts";
import { FakeDb } from "./helpers/fake-db.ts";

const WORK_ID = "78e9c71d-d6f2-4ea4-bcbb-42e4ec9300cf";

function request(
  payload: unknown,
  authenticated = true,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authenticated) headers.set("authorization", "Bearer test");
  return new Request("http://local/genre-hint", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function databases(hasGenreRow = true) {
  const caller = new FakeDb({
    genre_recommendations: hasGenreRow
      ? [{ user_id: "user-1", work_id: WORK_ID }]
      : [],
  });
  const service = new FakeDb({
    works: [{
      id: WORK_ID,
      hardcover_id: 383752,
      original_title: "Spin",
      original_authors: ["Robert Charles Wilson"],
      similar_ids: [],
      tags: {},
      hardcover_cover_url: "https://example.test/spin.jpg",
      refreshed_at: null,
    }],
  });
  return { caller, service };
}

Deno.test("genre-hint returns injected Hebrew hint and author for an owned genre row", async () => {
  const { caller, service } = databases();
  const seen: { title?: string; author?: string } = {};
  const handler = createHandler({
    requireUser: async () => "user-1",
    userClient: () => caller as never,
    serviceClient: () => service as never,
    hebrewHint: async (book) => {
      seen.title = book.title;
      return {
        source: "wikidata",
        title: "סחרור",
        author: "רוברט צ'רלס וילסון",
      };
    },
    hebrewAuthor: async (_db, author) => {
      seen.author = author;
      return "רוברט צ'רלס וילסון";
    },
  });

  const response = await handler(request({ work_id: WORK_ID }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    work_id: WORK_ID,
    hebrew_hint: {
      source: "wikidata",
      title: "סחרור",
      author: "רוברט צ'רלס וילסון",
    },
    hebrew_author: "רוברט צ'רלס וילסון",
  });
  assertEquals(seen, {
    title: "Spin",
    author: "Robert Charles Wilson",
  });
});

Deno.test("genre-hint rejects a missing genre row, bad body, and no JWT", async () => {
  const missing = databases(false);
  const missingHandler = createHandler({
    requireUser: async () => "user-1",
    userClient: () => missing.caller as never,
    serviceClient: () => missing.service as never,
  });
  assertEquals(
    (await missingHandler(request({ work_id: WORK_ID }))).status,
    404,
  );

  const owned = databases();
  const handler = createHandler({
    requireUser: async (req) => {
      if (!req.headers.get("authorization")) {
        throw new HttpError(401, "Authentication required.");
      }
      return "user-1";
    },
    userClient: () => owned.caller as never,
    serviceClient: () => owned.service as never,
  });
  assertEquals((await handler(request(null))).status, 400);
  assertEquals((await handler(request({}))).status, 400);
  assertEquals((await handler(request({ work_id: "not-a-uuid" }))).status, 400);
  assertEquals(
    (await handler(request({ work_id: WORK_ID }, false))).status,
    401,
  );
});

Deno.test("genre-hint turns a hint provider failure into a null hint", async () => {
  const { caller, service } = databases();
  const handler = createHandler({
    requireUser: async () => "user-1",
    userClient: () => caller as never,
    serviceClient: () => service as never,
    hebrewHint: async () => {
      throw new Error("provider down");
    },
    hebrewAuthor: async () => null,
  });

  const response = await handler(request({ work_id: WORK_ID }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    work_id: WORK_ID,
    hebrew_hint: null,
    hebrew_author: null,
  });
});
