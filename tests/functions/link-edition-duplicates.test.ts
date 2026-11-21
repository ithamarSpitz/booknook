import { assertEquals } from "jsr:@std/assert@1";
import {
  createHandler,
  sameBook,
} from "../../supabase/functions/link-edition/index.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const simania = {
  details: { title: "ד״ר ג׳קיל ומיסטר הייד", author: "סטיבנסון", coverUrl: null },
  rating: null,
};

const jekyll = {
  original_title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
  original_authors: ["Robert Louis Stevenson"],
};

function request() {
  return new Request("http://local/link-edition", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify({
      work_id: "work-a",
      simania_id: 32314,
      source: "wikidata",
      simania,
    }),
  });
}

function setup(workB: Record<string, unknown>, shelved = false) {
  const db = new FakeDb({
    works: [{ id: "work-a", ...jekyll }, { id: "work-b", ...workB }],
    editions: [
      edition({
        simania_id: 32314,
        work_id: "work-b",
        resolve_status: "nli",
        details_at: new Date().toISOString(),
      }),
      edition({
        simania_id: 32315,
        work_id: "work-b",
        resolve_status: "nli",
        details_at: new Date().toISOString(),
      }),
    ],
    recommendations: [{
      user_id: "user-1",
      work_id: "work-a",
      simania_id: null,
      dismissed: false,
    }],
    genre_recommendations: [],
    shelf_books: shelved
      ? [{ user_id: "user-1", simania_id: 32315, shelf_id: "s", position: 0 }]
      : [],
  });
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => db,
    userClient: () => db,
  });
  return { db, handler };
}

Deno.test("link-edition accepts an edition of a same-book duplicate work", async () => {
  const { db, handler } = setup(jekyll);
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(db.tables.recommendations[0].simania_id, 32314);
  assertEquals(db.tables.editions[0].work_id, "work-b");
});

Deno.test("link-edition still rejects an edition of a different book", async () => {
  const { db, handler } = setup({
    original_title: "Peter Pan",
    original_authors: ["J. M. Barrie"],
  });
  const response = await handler(request());
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: "Edition belongs to another work.",
  });
  assertEquals(db.tables.recommendations[0].simania_id, null);
});

Deno.test("link-edition counts the duplicate work's shelved edition", async () => {
  const { db, handler } = setup(jekyll, true);
  const response = await handler(request());
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Already on your shelves." });
  assertEquals(db.tables.recommendations.length, 0);
});

Deno.test("sameBook ignores a subtitle after a colon", () => {
  assertEquals(
    sameBook(
      { original_title: "Dune: Book One", original_authors: ["Frank Herbert"] },
      { original_title: "dune", original_authors: ["Frank Herbert"] },
    ),
    true,
  );
});

Deno.test("sameBook is false for different authors", () => {
  assertEquals(
    sameBook(
      { original_title: "Dune", original_authors: ["Frank Herbert"] },
      { original_title: "Dune", original_authors: ["Brian Herbert"] },
    ),
    false,
  );
});

Deno.test("link-edition accepts source hardcover", async () => {
  const { handler } = setup(jekyll);
  const response = await handler(
    new Request("http://local/link-edition", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({
        work_id: "work-a",
        simania_id: 32314,
        source: "hardcover",
        simania,
      }),
    }),
  );
  assertEquals(response.status, 200);
});
