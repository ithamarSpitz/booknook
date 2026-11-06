import { assertEquals } from "jsr:@std/assert@1";
import {
  createHandler,
  matchCandidates,
} from "../../supabase/functions/match-by-author/index.ts";
import { edition, FakeDb } from "./helpers/fake-db.ts";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";
import type { AuthorCandidate } from "../../supabase/functions/_shared/types.ts";

function work(overrides: Record<string, unknown> = {}) {
  return {
    id: "work-1",
    hardcover_id: 100,
    original_title: "English Title",
    original_authors: ["Author"],
    similar_ids: [],
    tags: {},
    hardcover_cover_url: null,
    refreshed_at: null,
    ...overrides,
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://local/match-by-author", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test",
    },
    body: JSON.stringify(body),
  });
}

function setup(
  options: {
    editions?: Record<string, unknown>[];
    works?: Record<string, unknown>[];
    dismissed?: boolean;
    recommendation?: boolean;
    genreRecommendation?: boolean;
    ensureResolved?: (
      db: FakeDb,
      row: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    now?: () => Date;
  } = {},
) {
  const db = new FakeDb({
    works: options.works ?? [work()],
    editions: options.editions ?? [],
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
  const resolveCalls: number[] = [];
  const ensureResolved = options.ensureResolved ??
    (async (_db, row: Record<string, unknown>) => {
      resolveCalls.push(row.simania_id as number);
      return row;
    });
  const handler = createHandler({
    requireUser: async () => "user-1",
    serviceClient: () => db,
    userClient: () => db,
    ensureResolved: ensureResolved as never,
    now: options.now ?? (() => new Date("2026-01-01T00:00:00.000Z")),
  });
  return { db, handler, resolveCalls, ensureResolved };
}

const candidate = (
  simania_id: number,
  title: string,
  author: string | null = "סופר",
): AuthorCandidate => ({ simania_id, title, author });

Deno.test("match-by-author returns the second candidate when the first resolves elsewhere", async () => {
  const { db, handler } = setup({
    works: [
      work({ id: "work-1", hardcover_id: 100 }),
      work({ id: "work-2", hardcover_id: 200 }),
    ],
    ensureResolved: async (db, row) => {
      const workId = row.simania_id === 1 ? "work-2" : "work-1";
      const status = row.simania_id === 1 ? "nli" : "wikidata";
      const existing = db.tables.editions.find((e) =>
        e.simania_id === row.simania_id
      );
      if (existing) {
        Object.assign(existing, {
          work_id: workId,
          resolve_status: status,
        });
        return existing;
      }
      return row;
    },
  });
  const response = await handler(request({
    work_id: "work-1",
    candidates: [candidate(1, "א"), candidate(2, "ב")],
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    simania_id: 2,
    resolve_status: "wikidata",
  });
  const first = db.tables.editions.find((e) => e.simania_id === 1);
  assertEquals(first?.work_id, "work-2");
});

Deno.test("match-by-author returns a linked candidate without resolving", async () => {
  const resolveCalls: number[] = [];
  const { handler } = setup({
    editions: [
      edition({
        simania_id: 77,
        work_id: "work-1",
        resolve_status: "wikidata",
        title: "סחרור",
      }),
    ],
    ensureResolved: async (_db, row) => {
      resolveCalls.push(row.simania_id as number);
      return row;
    },
  });
  const response = await handler(request({
    work_id: "work-1",
    candidates: [candidate(77, "סחרור")],
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    simania_id: 77,
    resolve_status: "wikidata",
  });
  assertEquals(resolveCalls.length, 0);
});

Deno.test("match-by-author returns nulls and skips a failing candidate", async () => {
  const { handler } = setup({
    works: [
      work({ id: "work-1", hardcover_id: 100 }),
      work({ id: "work-2", hardcover_id: 200 }),
    ],
    ensureResolved: async (_db, row) => {
      if (row.simania_id === 2) throw new Error("provider down");
      const existing = row;
      Object.assign(existing, { work_id: "work-2", resolve_status: "fuzzy" });
      return existing;
    },
  });
  const response = await handler(request({
    work_id: "work-1",
    candidates: [candidate(1, "א"), candidate(2, "ב"), candidate(3, "ג")],
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    simania_id: null,
    resolve_status: null,
  });
});

Deno.test("match-by-author rejects bad input and missing recommendations", async () => {
  const { handler } = setup();
  assertEquals(
    (await handler(request({
      work_id: "work-1",
      candidates: Array.from(
        { length: 9 },
        (_, i) => candidate(i + 1, `t${i}`),
      ),
    }))).status,
    400,
  );
  assertEquals(
    (await handler(request({
      work_id: "work-1",
      candidates: [candidate(1, "  ")],
    }))).status,
    400,
  );

  const noRec = setup({ dismissed: true });
  assertEquals(
    (await noRec.handler(request({
      work_id: "work-1",
      candidates: [candidate(1, "א")],
    }))).status,
    404,
  );

  const unauth = createHandler({
    requireUser: async () => {
      throw new HttpError(401, "Authentication required.");
    },
  });
  assertEquals(
    (await unauth(request({
      work_id: "work-1",
      candidates: [candidate(1, "א")],
    }))).status,
    401,
  );
});

Deno.test("match-by-author stops resolving after the 25 second budget", async () => {
  const t0 = Date.parse("2026-01-01T00:00:00.000Z");
  let nowCalls = 0;
  const resolveCalls: number[] = [];
  const db = new FakeDb({
    works: [work()],
    recommendations: [{
      user_id: "user-1",
      work_id: "work-1",
      simania_id: null,
      dismissed: false,
    }],
  });
  await matchCandidates(db, 100, [
    candidate(1, "א"),
    candidate(2, "ב"),
    candidate(3, "ג"),
  ], {
    ensureResolved: async (_db, row) => {
      resolveCalls.push(row.simania_id as number);
      return row;
    },
    now: () => {
      nowCalls += 1;
      if (nowCalls <= 2) return new Date(t0);
      return new Date(t0 + 26_000);
    },
  });
  assertEquals(resolveCalls, [1]);
});

Deno.test("match-by-author authorizes a genre recommendation", async () => {
  const { handler } = setup({
    recommendation: false,
    genreRecommendation: true,
  });
  const response = await handler(request({
    work_id: "work-1",
    candidates: [candidate(1, "title")],
  }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    simania_id: null,
    resolve_status: null,
  });
});

Deno.test("match-by-author returns 404 with neither recommendation row", async () => {
  const { handler } = setup({ recommendation: false });
  const response = await handler(request({
    work_id: "work-1",
    candidates: [candidate(1, "title")],
  }));
  assertEquals(response.status, 404);
});
