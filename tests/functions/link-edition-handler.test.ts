import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/link-edition/index.ts";
import {
  ensureEdition,
  suppliedSimania,
} from "../../supabase/functions/_shared/catalog.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";

const simania = {
  details: {
    title: "הנסיך הקטן",
    author: "אנטואן דה סנט-אכזופרי",
    coverUrl: "https://c/1.jpg",
  },
  rating: { rating: 4.5, count: 10 },
};

function request(body: Record<string, unknown>) {
  return new Request("http://local/link-edition", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify(body),
  });
}

function setup(
  editions: Record<string, unknown>[] = [],
  options: {
    recommendation?: boolean;
    dismissed?: boolean;
    genreRecommendation?: boolean;
  } = {},
) {
  const db = new FakeDb({
    editions,
    recommendations: options.recommendation === false ? [] : [{
      user_id: "user-1",
      work_id: "work-1",
      simania_id: null,
      dismissed: options.dismissed ?? false,
    }],
    genre_recommendations: options.genreRecommendation
      ? [{
        user_id: "user-1",
        work_id: "work-1",
        simania_id: null,
      }]
      : [],
  });
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => db,
    userClient: () => db,
  });
  return { db, handler };
}

const valid = {
  work_id: "work-1",
  simania_id: 77,
  source: "wikidata",
  simania,
};

Deno.test("link-edition stores the supplied edition, links it and localizes the recommendation", async () => {
  const { db, handler } = setup();
  const response = await handler(request(valid));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    work_id: "work-1",
    simania_id: 77,
    title: "הנסיך הקטן",
    author: "אנטואן דה סנט-אכזופרי",
    cover_url: "https://c/1.jpg",
  });
  const row = db.tables.editions[0];
  assertEquals([row.work_id, row.resolve_status, row.simania_rating], [
    "work-1",
    "wikidata",
    4.5,
  ]);
  assertEquals(db.tables.recommendations[0].simania_id, 77);
});

Deno.test("link-edition never relinks an edition of another work", async () => {
  const { db, handler } = setup([
    edition({
      simania_id: 77,
      work_id: "work-2",
      resolve_status: "nli",
      details_at: new Date().toISOString(),
    }),
  ]);
  const response = await handler(request(valid));
  assertEquals(response.status, 409);
  assertEquals(db.tables.editions[0].work_id, "work-2");
  assertEquals(db.tables.recommendations[0].simania_id, null);
});

Deno.test("link-edition requires a non-dismissed recommendation of the caller", async () => {
  const { db, handler } = setup([], { dismissed: true });
  assertEquals((await handler(request(valid))).status, 404);
  assertEquals(db.tables.editions.length, 0);
});

Deno.test("link-edition rejects a request without Simania data or with a bad source", async () => {
  const { handler } = setup();
  assertEquals(
    (await handler(request({ ...valid, simania: undefined }))).status,
    400,
  );
  assertEquals(
    (await handler(request({ ...valid, source: "fuzzy" }))).status,
    400,
  );
  assertEquals(
    (await handler(request({ ...valid, simania: { details: "x" } }))).status,
    400,
  );
});

Deno.test("suppliedSimania accepts absent data and validates its shape", () => {
  assertEquals(suppliedSimania(undefined), null);
  assertEquals(suppliedSimania({ details: { title: "x" } }), {
    details: { title: "x" },
    rating: null,
  });
});

Deno.test("ensureEdition keeps a stale cached row when the Simania refresh fails", async () => {
  const stale = edition({ details_at: "2020-01-01T00:00:00.000Z" });
  const db = new FakeDb({ editions: [stale] });
  const result = await ensureEdition(db, 1234, {
    bookDetails: () => Promise.reject(new Error("403")),
    bookRating: async () => null,
  });
  assertEquals(result.title, "ספר");
  let failed = false;
  await ensureEdition(new FakeDb(), 1234, {
    bookDetails: () => Promise.reject(new Error("403")),
    bookRating: async () => null,
  }).catch(() => (failed = true));
  assertEquals(failed, true);
});

Deno.test("link-edition rejects when the caller already shelved this edition", async () => {
  const { db, handler } = setup([
    edition({ simania_id: 77, work_id: null }),
  ]);
  db.tables.shelf_books = [{
    user_id: "user-1",
    simania_id: 77,
    shelf_id: "shelf-1",
    position: 0,
  }];
  const response = await handler(request(valid));
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Already on your shelves." });
  assertEquals(db.tables.editions[0].work_id, "work-1");
  assertEquals(db.tables.recommendations.length, 0);
});

Deno.test("link-edition rejects when the caller shelved another edition of the same work", async () => {
  const { db, handler } = setup([
    edition({ simania_id: 77, work_id: null }),
    edition({ simania_id: 88, work_id: "work-1", resolve_status: "wikidata" }),
  ]);
  db.tables.shelf_books = [{
    user_id: "user-1",
    simania_id: 88,
    shelf_id: "shelf-1",
    position: 0,
  }];
  const response = await handler(request(valid));
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Already on your shelves." });
  assertEquals(db.tables.editions[0].work_id, "work-1");
  assertEquals(db.tables.recommendations.length, 0);
});

Deno.test("link-edition does not delete a dismissed recommendation when shelved", async () => {
  const db = new FakeDb({
    editions: [edition({ simania_id: 77, work_id: null })],
    recommendations: [
      {
        user_id: "user-1",
        work_id: "work-1",
        simania_id: null,
        dismissed: false,
      },
      {
        user_id: "user-1",
        work_id: "work-1",
        simania_id: null,
        dismissed: true,
      },
    ],
    shelf_books: [{
      user_id: "user-1",
      simania_id: 77,
      shelf_id: "shelf-1",
      position: 0,
    }],
  });
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => db,
    userClient: () => db,
  });
  const response = await handler(request(valid));
  assertEquals(response.status, 409);
  assertEquals(db.tables.recommendations.length, 1);
  assertEquals(db.tables.recommendations[0].dismissed, true);
});

Deno.test("link-edition ignores another user's shelf of the same edition", async () => {
  const { db, handler } = setup([
    edition({ simania_id: 77, work_id: null }),
  ]);
  db.tables.shelf_books = [{
    user_id: "user-2",
    simania_id: 77,
    shelf_id: "shelf-1",
    position: 0,
  }];
  const response = await handler(request(valid));
  assertEquals(response.status, 200);
  assertEquals(db.tables.recommendations[0].simania_id, 77);
});

Deno.test("link-edition localizes a genre recommendation without an ordinary recommendation", async () => {
  const { db, handler } = setup([], {
    recommendation: false,
    genreRecommendation: true,
  });
  const response = await handler(request(valid));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    work_id: "work-1",
    simania_id: 77,
    title: simania.details.title,
    author: simania.details.author,
    cover_url: simania.details.coverUrl,
  });
  assertEquals(db.tables.genre_recommendations[0].simania_id, 77);
});

Deno.test("link-edition localizes both recommendation rows", async () => {
  const { db, handler } = setup([], { genreRecommendation: true });
  const response = await handler(request(valid));
  assertEquals(response.status, 200);
  assertEquals(db.tables.recommendations[0].simania_id, 77);
  assertEquals(db.tables.genre_recommendations[0].simania_id, 77);
});

Deno.test("link-edition removes a shelved work from a genre recommendation", async () => {
  const { db, handler } = setup([
    edition({ simania_id: 77, work_id: null }),
  ], {
    recommendation: false,
    genreRecommendation: true,
  });
  db.tables.shelf_books = [{
    user_id: "user-1",
    simania_id: 77,
    shelf_id: "shelf-1",
    position: 0,
  }];
  const response = await handler(request(valid));
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "Already on your shelves." });
  assertEquals(db.tables.genre_recommendations, []);
});

Deno.test("link-edition returns 404 with neither recommendation row", async () => {
  const { db, handler } = setup([], { recommendation: false });
  const response = await handler(request(valid));
  assertEquals(response.status, 404);
  assertEquals(db.tables.editions, []);
});
