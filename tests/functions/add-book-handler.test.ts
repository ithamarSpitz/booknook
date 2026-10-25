import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/add-book/index.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

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
    new Request("http://local/add-book", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test",
      },
      body: JSON.stringify({ simania_id: 1234, shelf_id: "shelf-1" }),
    }),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Book is already on a shelf." });
});
