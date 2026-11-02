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
  #filters: Filter[] = [];
  #order: { column: string; ascending: boolean } | null = null;
  #limit: number | null = null;
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
    this.#filters.push([name, value]);
    return this;
  }
  in(name: string, values: unknown[]): this {
    this.#filters.push(["__in__", name, values]);
    return this;
  }
  contains(name: string, values: unknown[]): this {
    this.#filters.push(["__contains__", name, values]);
    return this;
  }
  not(name: string, operator: string, value: unknown): this {
    if (operator === "is" && value === null) {
      this.#filters.push(["__notnull__", name]);
    }
    return this;
  }
  order(name: string, options: { ascending?: boolean } = {}): this {
    this.#order = { column: name, ascending: options.ascending ?? true };
    return this;
  }
  limit(count: number): this {
    this.#limit = count;
    return this;
  }
  #matches(row: Record<string, unknown>): boolean {
    return this.#filters.every((filter) => {
      if (filter[0] === "__in__") {
        const column = filter[1] as string;
        const values = filter[2] as unknown[];
        return values.includes(row[column]);
      }
      if (filter[0] === "__contains__") {
        const column = filter[1] as string;
        const values = filter[2] as unknown[];
        const field = row[column];
        if (!Array.isArray(field)) return false;
        return values.every((value) => field.includes(value));
      }
      if (filter[0] === "__notnull__") {
        const column = filter[1] as string;
        return row[column] !== null && row[column] !== undefined;
      }
      const [column, value] = filter;
      return row[column] === value;
    });
  }
  #selectRows(): unknown[] {
    let rows: Record<string, unknown>[] = [];
    if (this.table === "shelf_books") rows = this.db.library as Record<string, unknown>[];
    if (this.table === "recommendations") {
      const dismissedOnly = this.#filters.some((filter) =>
        filter[0] === "dismissed" && filter[1] === true
      );
      return dismissedOnly
        ? this.db.dismissed.map((work_id) => ({ work_id }))
        : [];
    }
    if (this.table === "works") {
      rows = this.db.works as unknown as Record<string, unknown>[];
    }
    if (this.table === "editions") {
      rows = this.db.editions as unknown as Record<string, unknown>[];
    }
    let matched = rows.filter((row) => this.#matches(row));
    if (this.#order) {
      const { column, ascending } = this.#order;
      matched = [...matched].sort((left, right) => {
        const a = left[column];
        const b = right[column];
        if (a === b) return 0;
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        const cmp = a < b ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.#limit !== null) matched = matched.slice(0, this.#limit);
    return matched;
  }
  maybeSingle(): Promise<{ data: unknown; error: null }> {
    const rows = this.#selectRows();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
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
    if (this.table === "works" && this.operation === "upsert") {
      data = this.payload;
    } else if (this.operation === "select") {
      data = this.#selectRows();
    }
    return Promise.resolve({ data, error: null }).then(
      onfulfilled ?? undefined,
    );
  }
}

type Filter =
  | [string, unknown]
  | ["__in__", string, unknown[]]
  | ["__contains__", string, unknown[]]
  | ["__notnull__", string];

class FakeDb {
  replacement: Record<string, unknown>[] | null = null;
  constructor(
    public library: unknown[],
    public works: WorkRow[],
    public dismissed: string[] = [],
    public editions: EditionRow[] = [],
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
    user_id: "user",
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

Deno.test("English-only card uses catalog Hebrew author without Wikidata", async () => {
  const seed = work("seed", 1, [100]);
  const candidate = work("candidate", 100);
  candidate.original_authors = ["Freida McFadden"];
  const catalogWork = work("catalog", 9999);
  catalogWork.original_authors = ["Freida McFadden"];
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate, catalogWork],
    [],
    [{
      simania_id: 555,
      work_id: "catalog",
      title: "משרתת",
      author: "פרידה מקפדן",
      resolve_status: "wikidata",
      resolved_at: "2026-10-01T00:00:00Z",
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
    }],
  );
  let wikidataCalled = false;
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => {
      wikidataCalled = true;
      return "לא";
    },
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(payload.recommendations.length === 1, "expected one card");
  assert(
    payload.recommendations[0].hebrew_author === "פרידה מקפדן",
    "catalog Hebrew author should be returned",
  );
  assert(!wikidataCalled, "Wikidata author bridge should not run");
});

Deno.test("English-only card uses Wikidata Hebrew author when catalog misses", async () => {
  const seed = work("seed", 1, [100]);
  const candidate = work("candidate", 100);
  candidate.original_authors = ["Freida McFadden"];
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => "פרדריק בקמן",
  });
  const payload = await response.json();
  assert(
    payload.recommendations[0].hebrew_author === "פרדריק בקמן",
    "Wikidata author should be used",
  );
});

Deno.test("English-only card leaves hebrew_author null when Wikidata misses", async () => {
  const seed = work("seed", 1, [100]);
  const candidate = work("candidate", 100);
  candidate.original_authors = ["Freida McFadden"];
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => null,
  });
  const payload = await response.json();
  assert(payload.recommendations[0].hebrew_author === null, "expected null author");
});

Deno.test("localized recommendation card has null hebrew_author", async () => {
  const seed = work("seed", 1, [100]);
  const candidate = work("candidate", 100);
  candidate.original_authors = ["Freida McFadden"];
  const linkedEdition: EditionRow = {
    simania_id: 777,
    work_id: "candidate",
    title: "משרתת",
    author: "פרידה מקפדן",
    resolve_status: "wikidata",
    resolved_at: "2026-10-01T00:00:00Z",
    translator: null,
    publisher: null,
    series: null,
    category: null,
    year: null,
    pages: null,
    description: null,
    cover_url: "https://cover",
    simania_rating: null,
    simania_rating_count: null,
    details_at: null,
  };
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate],
    [],
    [linkedEdition],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    wikidataHebrewAuthor: async () => "לא",
  });
  const payload = await response.json();
  assert(payload.recommendations[0].simania_id === 777, "expected localized card");
  assert(
    payload.recommendations[0].hebrew_author === null,
    "localized card should not carry hebrew_author",
  );
});

Deno.test("same English author on two cards triggers one Hebrew author lookup", async () => {
  const seed = work("seed", 1, [100, 101]);
  const first = work("first", 100);
  first.original_authors = ["Freida McFadden"];
  const second = work("second", 101);
  second.original_authors = ["Freida McFadden"];
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, first, second],
  );
  let lookupCount = 0;
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => {
      lookupCount += 1;
      return "פרידה מקפדן";
    },
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(payload.recommendations.length === 2, "expected two cards");
  assert(lookupCount === 1, "author lookup should be cached per request");
});
