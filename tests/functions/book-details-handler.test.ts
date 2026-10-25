import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/book-details/index.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

Deno.test("book-details refreshes only the edition and returns null shelf fields", async () => {
  const current = edition({ simania_rating: 4.5 }) as EditionRow;
  let ensured = 0;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => new FakeDb(),
    ensureEdition: async () => {
      ensured++;
      return current;
    },
  });
  const response = await handler(
    new Request("http://local/book-details", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test",
      },
      body: JSON.stringify({ simania_id: 1234 }),
    }),
  );
  const payload = await response.json();
  assertEquals(response.status, 200);
  assertEquals(ensured, 1);
  assertEquals(payload.book.shelf_id, null);
  assertEquals(payload.book.shelf_name, null);
  assertEquals(payload.book.resolve_status, "pending");
  assertEquals(payload.book.simania_rating, 4.5);
});
