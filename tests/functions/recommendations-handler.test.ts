import { handleRecommendations } from "../../supabase/functions/recommendations/index.ts";
import type {
  EditionRow,
  WorkRow,
} from "../../supabase/functions/_shared/types.ts";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  #filters: Record<string, unknown> = {};
  constructor(
    private db: FakeDb,
    private table: string,
    private operation = "select",
    private payload?: unknown,
  ) {}
  select(): this {
    return this;
  }
  eq(name: string, value: unknown): this {
    this.#filters[name] = value;
    return this;
  }
  in(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: null, error: null });
  }
  single(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: this.payload, error: null });
  }
  upsert(payload: unknown): FakeQuery {
    return new FakeQuery(this.db, this.table, "upsert", payload);
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
        value: { data: unknown; error: null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    _onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    let data: unknown = [];
    if (this.table === "shelf_books") data = this.db.library;
    if (this.table === "recommendations") {
      data = this.#filters.dismissed
        ? this.db.dismissed.map((work_id) => ({ work_id }))
        : [];
    }
    if (this.table === "works") {
      data = this.operation === "upsert" ? this.payload : this.db.works;
    }
    return Promise.resolve({ data, error: null }).then(
      onfulfilled ?? undefined,
    );
  }
}

class FakeDb {
  replacement: Record<string, unknown>[] | null = null;
  constructor(
    public library: unknown[],
    public works: WorkRow[],
    public dismissed: string[] = [],
  ) {}
  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
  rpc(
    _name: string,
    args: { p_rows: Record<string, unknown>[] },
  ): Promise<{ data: unknown[]; error: null }> {
    this.replacement = args.p_rows;
    return Promise.resolve({
      data: args.p_rows.map((row) => ({
        ...row,
        user_id: "user",
        dismissed: false,
        generated_at: "2026-10-25T10:00:00Z",
      })),
      error: null,
    });
  }
}

function work(
  id: string,
  hardcoverId: number,
  similarIds: number[] = [],
): WorkRow {
  return {
    id,
    hardcover_id: hardcoverId,
    original_title: `Title ${id}`,
    original_authors: [`Author ${id}`],
    similar_ids: similarIds,
    tags: {},
    hardcover_cover_url: null,
    refreshed_at: null,
  };
}

function shelfBook(
  simaniaId: number,
  kind: string,
  value: WorkRow | null,
  options: {
    added_at?: string;
    rating?: number | null;
    edition?: Partial<EditionRow>;
  } = {},
): unknown {
  const work_id = value?.id ?? options.edition?.work_id ?? null;
  const edition: EditionRow = {
    simania_id: simaniaId,
    title: options.edition?.title ?? `Seed ${simaniaId}`,
    work_id,
    resolve_status: work_id ? "wikidata" : "pending",
    resolved_at: work_id ? "2026-01-01T00:00:00Z" : null,
    author: null,
    translator: null,
    publisher: null,
    series: null,
    category: null,
    year: null,
    pages: null,
    description: null,
    cover_url: null,
    simania_rating: null,
    simania_rating_count: null,
    details_at: null,
    ...options.edition,
  };
  return {
    simania_id: simaniaId,
    position: 0,
    added_at: options.added_at ?? "2026-01-01T00:00:00Z",
    finished_at: null,
    rating: options.rating ?? null,
    shelves: { kind },
    editions: {
      ...edition,
      works: value,
    },
  };
}

function request(): Request {
  return new Request("http://local/recommendations", {
    method: "POST",
    headers: {
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

Deno.test("zero seeds clears non-dismissed recommendations", async () => {
  const db = new FakeDb([], []);
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
  });
  assert(response.status === 200, "expected 200");
  assert(
    JSON.stringify(await response.json()) === '{"recommendations":[]}',
    "expected empty response",
  );
  assert(db.replacement?.length === 0, "expected empty replacement RPC");
});

Deno.test("handler excludes shelved and dismissed works and retains an English-only result", async () => {
  const seed = work("seed", 1, [2, 3, 4]);
  const shelved = work("shelved", 2);
  const dismissed = work("dismissed", 3);
  const kept = work("kept", 4);
  const db = new FakeDb(
    [shelfBook(11, "read", seed), shelfBook(22, "want", shelved)],
    [shelved, dismissed, kept],
    ["dismissed"],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => ({ source: "wikidata", title: "נשמר", author: null }),
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(
    db.replacement?.length === 1 && db.replacement[0].work_id === "kept",
    "only eligible work should be stored",
  );
  assert(
    payload.recommendations[0].simania_id === null,
    "English-only card should have null Simania ID",
  );
  assert(
    payload.recommendations[0].english_only === true &&
      payload.recommendations[0].can_add === false,
    "English-only flags mismatch",
  );
  assert(
    payload.recommendations[0].hebrew_hint?.title === "נשמר",
    "English-only card should carry the Hebrew hint for the browser match",
  );
});

Deno.test("unauthenticated request returns 401", async () => {
  const response = await handleRecommendations(request(), {
    authenticate: async () => {
      throw new HttpError(401, "Authentication required.");
    },
  });
  assert(response.status === 401, "expected 401");
});

Deno.test("self-heal links a pending shelved edition and it seeds and excludes its work", async () => {
  const parisWork = work("paris", 9001, [8002]);
  parisWork.original_title = "The Paris Apartment";
  const otherWork = work("other", 8002);
  const seedWork = work("seed", 1, [9001, 8002]);
  const library = [
    shelfBook(100, "read", seedWork, { rating: 5 }),
    shelfBook(200, "read", null, {
      added_at: "2026-06-01T00:00:00Z",
      rating: 4,
      edition: {
        title: "הדירה בפריז",
        resolve_status: "pending",
        work_id: null,
        resolved_at: null,
      },
    }),
  ];
  const db = new FakeDb(library, [seedWork, parisWork, otherWork]);
  const resolveCalls: number[] = [];
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    ensureResolved: async (_db, edition) => {
      resolveCalls.push(edition.simania_id);
      const row = library.find((item) =>
        (item as { simania_id: number }).simania_id === edition.simania_id
      ) as {
        editions: EditionRow & { works: WorkRow | null };
      };
      row.editions.work_id = parisWork.id;
      row.editions.works = parisWork;
      row.editions.resolve_status = "nli";
      return { ...edition, work_id: parisWork.id, resolve_status: "nli" };
    },
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(
    resolveCalls.length === 1 && resolveCalls[0] === 200,
    "pending shelved edition should be resolved once",
  );
  const replacement = db.replacement as {
    work_id: string;
    because: number[];
  }[] | null;
  assert(
    replacement?.length === 1 && replacement[0].work_id === "other",
    "linked Paris work should be excluded from recommendations",
  );
  assert(
    replacement[0].because.includes(200),
    "newly linked shelved book should seed recommendations",
  );
  assert(payload.recommendations.length === 1, "expected one card");
});

Deno.test("self-heal resolves at most two newest eligible editions", async () => {
  const linked = work("linked", 10);
  const library = [
    shelfBook(401, "want", null, {
      added_at: "2026-05-01T00:00:00Z",
      edition: { resolve_status: "pending", work_id: null },
    }),
    shelfBook(402, "want", null, {
      added_at: "2026-04-01T00:00:00Z",
      edition: { resolve_status: "pending", work_id: null },
    }),
    shelfBook(403, "want", null, {
      added_at: "2026-03-01T00:00:00Z",
      edition: { resolve_status: "pending", work_id: null },
    }),
    shelfBook(404, "want", linked, {
      added_at: "2026-07-01T00:00:00Z",
    }),
    shelfBook(405, "want", null, {
      added_at: "2026-06-01T00:00:00Z",
      edition: {
        resolve_status: "not_found",
        work_id: null,
        resolved_at: new Date().toISOString(),
      },
    }),
    shelfBook(406, "want", null, {
      added_at: "2026-01-01T00:00:00Z",
      edition: {
        resolve_status: "not_found",
        work_id: null,
        resolved_at: "2020-01-01T00:00:00Z",
      },
    }),
  ];
  const db = new FakeDb(library, [linked]);
  const resolveCalls: number[] = [];
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    ensureResolved: async (_db, edition) => {
      resolveCalls.push(edition.simania_id);
      return edition;
    },
  });
  assert(response.status === 200, "expected 200");
  assert(
    resolveCalls.length === 2 &&
      resolveCalls[0] === 401 &&
      resolveCalls[1] === 402,
    "only the two newest pending editions should be resolved",
  );
  assert(!resolveCalls.includes(404), "linked edition should not be resolved");
  assert(!resolveCalls.includes(405), "recent not_found should not be resolved");
  assert(!resolveCalls.includes(406), "older not_found waits its turn after pending");
});

Deno.test("self-heal resolver failure does not fail the request", async () => {
  const seed = work("seed", 1, [2]);
  const candidate = work("kept", 2);
  const db = new FakeDb(
    [
      shelfBook(11, "read", seed, { rating: 4 }),
      shelfBook(12, "want", null, {
        edition: { resolve_status: "pending", work_id: null },
      }),
    ],
    [seed, candidate],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    ensureResolved: async () => {
      throw new Error("resolver blew up");
    },
  });
  assert(response.status === 200, "expected 200");
});

Deno.test("self-heal skips when every shelved edition is linked", async () => {
  const seed = work("seed", 1, [2]);
  const candidate = work("kept", 2);
  const db = new FakeDb([shelfBook(11, "read", seed, { rating: 4 })], [
    seed,
    candidate,
  ]);
  const resolveCalls: number[] = [];
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    ensureResolved: async (_db, edition) => {
      resolveCalls.push(edition.simania_id);
      return edition;
    },
  });
  assert(response.status === 200, "expected 200");
  assert(resolveCalls.length === 0, "resolver should not run without unlinked editions");
});
