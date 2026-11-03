import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/add-book/index.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

function request(body: Record<string, unknown>) {
  return new Request("http://local/add-book", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("add-book maps only the named duplicate-book conflict to 409", async () => {
  const callerDb = new FakeDb({
    shelves: [{ id: "shelf-1", user_id: "user-1" }],
  });
  callerDb.nextInsertError = {
    code: "23505",
    message: "duplicate",
    details: "shelf_books_user_work_key",
  };
  const current = edition() as EditionRow;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => callerDb,
    ensureEdition: async () => current,
    ensureResolved: async () => current,
  });
  const response = await handler(
    request({ simania_id: 1234, shelf_id: "shelf-1" }),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Book is already on a shelf." });
});

Deno.test("add-book shelves an English edition without calling Simania dependencies", async () => {
  const callerDb = new FakeDb({
    shelves: [{
      id: "shelf-1",
      user_id: "user-1",
      name: "רוצה לקרוא",
      kind: "want",
    }],
  });
  const english = edition({
    simania_id: -383752,
    work_id: "work-1",
    resolve_status: "hardcover",
    title: "Spin",
    author: "Robert Charles Wilson",
  }) as EditionRow;
  let englishId: number | null = null;
  let simaniaCalls = 0;
  let resolverCalls = 0;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => callerDb,
    ensureEnglishEdition: async (_db, hardcoverId) => {
      englishId = hardcoverId;
      return english;
    },
    ensureEdition: async () => {
      simaniaCalls++;
      return english;
    },
    ensureResolved: async () => {
      resolverCalls++;
      return english;
    },
  });

  const response = await handler(
    request({ hardcover_id: 383752, shelf_id: "shelf-1" }),
  );
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(englishId, 383752);
  assertEquals(simaniaCalls, 0);
  assertEquals(resolverCalls, 0);
  assertEquals(callerDb.tables.shelf_books[0].simania_id, -383752);
  assertEquals(payload.resolve_status, "hardcover");
  assertEquals(payload.book.simania_id, -383752);
});

Deno.test("add-book rejects invalid Simania and Hardcover ID combinations", async () => {
  const handler = createHandler({ requireUser: async () => "user-1" });
  const invalidBodies = [
    { shelf_id: "shelf-1" },
    { simania_id: 1234, hardcover_id: 383752, shelf_id: "shelf-1" },
    { simania_id: 1234, hardcover_id: -1, shelf_id: "shelf-1" },
    { hardcover_id: -1, shelf_id: "shelf-1" },
  ];

  for (const invalidBody of invalidBodies) {
    const response = await handler(request(invalidBody));
    assertEquals(response.status, 400);
  }
});

Deno.test("add-book maps an English-edition duplicate to 409", async () => {
  const callerDb = new FakeDb({
    shelves: [{ id: "shelf-1", user_id: "user-1" }],
  });
  callerDb.nextInsertError = {
    code: "23505",
    message: "duplicate",
    details: "shelf_books_pkey",
  };
  const english = edition({
    simania_id: -383752,
    resolve_status: "hardcover",
  }) as EditionRow;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => callerDb,
    ensureEnglishEdition: async () => english,
  });

  const response = await handler(
    request({ hardcover_id: 383752, shelf_id: "shelf-1" }),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Book is already on a shelf." });
});
