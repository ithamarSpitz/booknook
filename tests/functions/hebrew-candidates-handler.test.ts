import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "../../supabase/functions/hebrew-candidates/index.ts";
import { FakeDb } from "./helpers/fake-db.ts";

const WORK_ID = "78e9c71d-d6f2-4ea4-bcbb-42e4ec9300cf";

function request(payload: unknown): Request {
  return new Request("http://local/hebrew-candidates", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify(payload),
  });
}

function databases(kind: "none" | "genre" | "recommendation") {
  const caller = new FakeDb({
    recommendations: kind === "recommendation"
      ? [{ user_id: "user-1", work_id: WORK_ID, dismissed: false }]
      : [],
    genre_recommendations: kind === "genre"
      ? [{ user_id: "user-1", work_id: WORK_ID }]
      : [],
  });
  const service = new FakeDb({
    works: [{
      id: WORK_ID,
      hardcover_id: 42,
      original_title: "Never Lie",
      original_authors: ["Freida McFadden"],
    }],
  });
  return { caller, service };
}

function handler(kind: "none" | "genre" | "recommendation") {
  const { caller, service } = databases(kind);
  return createHandler({
    requireUser: async () => "user-1",
    userClient: () => caller as never,
    serviceClient: () => service as never,
    hardcoverBooks: async () => [{
      id: 42,
      title: "Never Lie",
      description: "Inside, Tricia meets Ethan.",
    }],
    candidates: async (work) => ({
      candidates: [{
        title: "לעולם אל תשקר",
        author: "פרידה מקפדן",
        rule: "G",
      }],
      english_names: work.description ? ["Tricia", "Ethan"] : [],
    }),
  });
}

Deno.test("hebrew-candidates returns 404 without an eligible row", async () => {
  assertEquals(
    (await handler("none")(request({ work_id: WORK_ID }))).status,
    404,
  );
});

for (const kind of ["genre", "recommendation"] as const) {
  Deno.test(`hebrew-candidates returns 200 with a ${kind} row`, async () => {
    const response = await handler(kind)(request({ work_id: WORK_ID }));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      work_id: WORK_ID,
      candidates: [{
        title: "לעולם אל תשקר",
        author: "פרידה מקפדן",
        rule: "G",
      }],
      english_names: ["Tricia", "Ethan"],
    });
  });
}

Deno.test("hebrew-candidates returns 400 for a bad body", async () => {
  const run = handler("genre");
  assertEquals((await run(request(null))).status, 400);
  assertEquals((await run(request({}))).status, 400);
  assertEquals((await run(request({ work_id: "bad" }))).status, 400);
});
