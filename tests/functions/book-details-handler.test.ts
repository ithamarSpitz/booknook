import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/book-details/index.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

function request() {
  return new Request("http://local/book-details", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify({ simania_id: 1234 }),
  });
}

Deno.test("book-details retries resolution for a pending edition and returns null shelf fields", async () => {
  const current = edition({ simania_rating: 4.5 }) as EditionRow;
  let ensured = 0;
  let resolved = 0;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => new FakeDb(),
    ensureEdition: async () => {
      ensured++;
      return current;
    },
    ensureResolved: async (_db, row) => {
      resolved++;
      return row;
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
  assertEquals(resolved, 1);
  assertEquals(payload.book.shelf_id, null);
  assertEquals(payload.book.shelf_name, null);
  assertEquals(payload.book.resolve_status, "pending");
  assertEquals(payload.book.simania_rating, 4.5);
});

Deno.test("book-details does not resolve an edition that already has a result", async () => {
  const current = edition({ resolve_status: "not_found" }) as EditionRow;
  let resolved = 0;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => new FakeDb(),
    ensureEdition: async () => current,
    ensureResolved: async (_db, row) => {
      resolved++;
      return row;
    },
  });
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(resolved, 0);
});

Deno.test("book-details serves a negative English edition without Simania or resolution", async () => {
  const english = edition({
    simania_id: -383752,
    work_id: "work-1",
    resolve_status: "hardcover",
    title: "Spin",
  }) as EditionRow;
  let englishId: number | null = null;
  let simaniaCalls = 0;
  let resolverCalls = 0;
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => new FakeDb(),
    userClient: () => new FakeDb(),
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
    new Request("http://local/book-details", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test",
      },
      body: JSON.stringify({ simania_id: -383752 }),
    }),
  );
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(englishId, 383752);
  assertEquals(simaniaCalls, 0);
  assertEquals(resolverCalls, 0);
  assertEquals(payload.book.simania_id, -383752);
  assertEquals(payload.book.resolve_status, "hardcover");
});
