import {
  handleRecommendations,
  hebrewAuthorFor,
} from "../../supabase/functions/recommendations/index.ts";
import {
  bookCard,
  ensureResolved,
} from "../../supabase/functions/_shared/catalog.ts";
import type {
  EditionRow,
  WorkRow,
} from "../../supabase/functions/_shared/types.ts";
import { GENRE_MAP } from "../../supabase/functions/_shared/genres.ts";
import { HttpError } from "../../supabase/functions/_shared/utils.ts";
import { FakeDb as SharedFakeDb } from "./helpers/fake-db.ts";

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
  gt(name: string, value: number): this {
    this.#filters.push(["__gt__", name, value]);
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
      if (filter[0] === "__gt__") {
        const column = filter[1] as string;
        const value = filter[2] as number;
        return typeof row[column] === "number" && row[column] > value;
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
    if (this.table === "shelf_books") {
      rows = this.db.library as Record<string, unknown>[];
    }
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
  | ["__gt__", string, number]
  | ["__notnull__", string];

class FakeDb {
  replacement: Record<string, unknown>[] | null = null;
  genreReplacement: Record<string, unknown>[] | null = null;
  ordinaryResultWorkIds: Set<string> | null = null;
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
    name: string,
    args: { p_rows: Record<string, unknown>[] },
  ): Promise<{ data: unknown[]; error: null }> {
    if (name === "replace_genre_recommendations") {
      this.genreReplacement = args.p_rows;
      return Promise.resolve({ data: [], error: null });
    }
    this.replacement = args.p_rows;
    const rows = this.ordinaryResultWorkIds
      ? args.p_rows.filter((row) =>
        this.ordinaryResultWorkIds!.has(String(row.work_id))
      )
      : args.p_rows;
    return Promise.resolve({
      data: rows.map((row) => ({
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

function withGenre(value: WorkRow, tag: string): WorkRow {
  value.tags = { Genre: [{ tag }] };
  return value;
}

function linkedEdition(
  simaniaId: number,
  workId: string,
  resolvedAt: string | null,
): EditionRow {
  return {
    simania_id: simaniaId,
    work_id: workId,
    title: `Edition ${simaniaId}`,
    author: null,
    resolve_status: simaniaId < 0 ? "hardcover" : "wikidata",
    resolved_at: resolvedAt,
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
  assert(
    db.genreReplacement?.length === 0,
    "expected genre rows to be cleared",
  );
});

Deno.test("genre shelves are ordered and choose recommendation, catalog, then null editions", async () => {
  const fantasyCandidates = [101, 102, 103, 104];
  const mysteryCandidates = [201, 202, 203, 204];
  const fantasyOne = withGenre(
    work("fantasy-1", 1, fantasyCandidates),
    "Fantasy",
  );
  const fantasyTwo = withGenre(
    work("fantasy-2", 2, fantasyCandidates),
    "Fantasy",
  );
  const mysteryOne = withGenre(
    work("mystery-1", 3, mysteryCandidates),
    "Mystery",
  );
  const mysteryTwo = withGenre(
    work("mystery-2", 4, mysteryCandidates),
    "Mystery",
  );
  const candidates = [
    ...fantasyCandidates.map((id) =>
      withGenre(work(`candidate-${id}`, id), "Fantasy")
    ),
    ...mysteryCandidates.map((id) =>
      withGenre(work(`candidate-${id}`, id), "Mystery")
    ),
  ];
  const db = new FakeDb(
    [
      shelfBook(11, "read", fantasyOne, { rating: 5 }),
      shelfBook(12, "read", fantasyTwo, { rating: 4 }),
      shelfBook(13, "read", mysteryOne, { rating: 4 }),
      shelfBook(14, "read", mysteryTwo, { rating: 3 }),
    ],
    [fantasyOne, fantasyTwo, mysteryOne, mysteryTwo, ...candidates],
    [],
    [
      linkedEdition(1101, "candidate-101", "2026-01-01T00:00:00Z"),
      linkedEdition(1201, "candidate-102", "2025-01-01T00:00:00Z"),
      linkedEdition(1202, "candidate-102", "2026-02-01T00:00:00Z"),
      linkedEdition(-103, "candidate-103", "2026-03-01T00:00:00Z"),
    ],
  );
  db.ordinaryResultWorkIds = new Set(["candidate-101"]);
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => null,
  });

  assert(response.status === 200, "expected 200");
  const rows = db.genreReplacement ?? [];
  assert(rows.length === 8, "expected two four-book genre shelves");
  assert(
    rows[0].genre === GENRE_MAP[1].name,
    "fantasy should be first by evidence",
  );
  assert(rows[4].genre === GENRE_MAP[4].name, "mystery should be second");
  assert(
    rows[0].shelf_position === 0 && rows[0].position === 0,
    "wrong first position",
  );
  assert(
    rows[4].shelf_position === 1 && rows[4].position === 0,
    "wrong second shelf position",
  );
  assert(
    rows[0].simania_id === 1101,
    "ordinary recommendation edition should win",
  );
  assert(
    rows[1].simania_id === 1202,
    "most recently resolved catalog edition expected",
  );
  assert(rows[2].simania_id === null, "negative editions must not be selected");
  assert(
    JSON.stringify(rows[0].because) === JSON.stringify([11, 12]),
    "genre replacement should carry contributing seed IDs",
  );
  assert(
    JSON.stringify(rows[4].because) === JSON.stringify([13, 14]),
    "each genre row should carry only its contributing seeds",
  );
});

Deno.test("reading shelf books seed genre shelves with weight 2.5", async () => {
  const candidateIds = [301, 302, 303, 304];
  const rated = withGenre(work("rated", 1, candidateIds), "Fantasy");
  const reading = withGenre(work("reading", 2, candidateIds), "Fantasy");
  const candidates = candidateIds.map((id) =>
    withGenre(work(`candidate-${id}`, id), "Fantasy")
  );
  const db = new FakeDb(
    [
      shelfBook(21, "read", rated, { rating: 5 }),
      shelfBook(22, "reading", reading),
    ],
    [rated, reading, ...candidates],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => null,
  });

  assert(response.status === 200, "expected 200");
  assert(
    db.genreReplacement?.length === 4,
    "reading seed should qualify the genre",
  );
  assert(
    db.genreReplacement?.[0].score === 7.5,
    "reading seed should add weight 2.5",
  );
});

Deno.test("genre step failure leaves the ordinary response unchanged", async () => {
  const seed = work("seed", 1, [100]);
  const candidate = work("candidate", 100);
  const db = new FakeDb(
    [shelfBook(31, "read", seed, { rating: 5 })],
    [seed, candidate],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => null,
    genreRecommendations: async () => {
      throw new Error("genre failure");
    },
  });
  const payload = await response.json();

  assert(response.status === 200, "genre failure must not fail the request");
  assert(
    payload.recommendations.length === 1,
    "ordinary card should be returned",
  );
  assert(
    payload.recommendations[0].work_id === "candidate",
    "ordinary response changed",
  );
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
    hebrewHint: async () => ({
      source: "wikidata",
      title: "נשמר",
      author: null,
    }),
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
      payload.recommendations[0].can_add === true,
    "English-only flags mismatch",
  );
  assert(
    payload.recommendations[0].hardcover_id === 4,
    "English-only card should expose its Hardcover ID",
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
    shelfBook(-383752, "want", null, {
      added_at: "2026-08-01T00:00:00Z",
      edition: { resolve_status: "pending", work_id: null },
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
  assert(
    !resolveCalls.includes(405),
    "recent not_found should not be resolved",
  );
  assert(
    !resolveCalls.includes(406),
    "older not_found waits its turn after pending",
  );
  assert(
    !resolveCalls.includes(-383752),
    "English edition should not be resolved",
  );
});

Deno.test("linked English edition seeds recommendations with its exact title", async () => {
  const englishSeed = work("spin", 383752, [100]);
  const candidate = work("candidate", 100);
  const db = new FakeDb(
    [shelfBook(-383752, "read", englishSeed, {
      rating: 5,
      edition: {
        title: "Spin",
        resolve_status: "hardcover",
        work_id: englishSeed.id,
      },
    })],
    [englishSeed, candidate],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => null,
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(payload.recommendations.length === 1, "expected one recommendation");
  assert(
    payload.recommendations[0].because[0] === -383752,
    "English edition should contribute as a seed",
  );
  assert(
    payload.recommendations[0].because_titles[0] === "Spin",
    "because_titles should use the English edition title",
  );
});

Deno.test("ensureResolved returns a negative-ID edition without provider calls", async () => {
  const current: EditionRow = {
    simania_id: -383752,
    work_id: null,
    resolve_status: "pending",
    resolved_at: null,
    title: "Spin",
    author: "Robert Charles Wilson",
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
  };
  let calls = 0;
  const provider = async () => {
    calls += 1;
    throw new Error("provider should not be called");
  };
  const result = await ensureResolved(
    {
      from: () => {
        throw new Error("database should not be queried");
      },
    },
    current,
    {
      wikidataOriginal: provider as never,
      nliOriginal: provider as never,
      wikidataEnglishAuthor: provider as never,
      findHardcoverBook: provider as never,
      now: () => {
        calls += 1;
        return new Date();
      },
    },
  );
  assert(
    result === current,
    "negative-ID edition should be returned unchanged",
  );
  assert(calls === 0, "negative-ID edition should bypass providers");
});

Deno.test("bookCard marks negative IDs as English editions", async () => {
  const current: EditionRow = {
    simania_id: -383752,
    work_id: "spin",
    resolve_status: "hardcover",
    resolved_at: "2026-11-03T00:00:00Z",
    title: "Spin",
    author: "Robert Charles Wilson",
    translator: null,
    publisher: null,
    series: null,
    category: null,
    year: 2005,
    pages: null,
    description: null,
    cover_url: null,
    simania_rating: null,
    simania_rating_count: null,
    details_at: "2026-11-03T00:00:00Z",
  };
  const card = await bookCard(new FakeDb([], []) as never, "user", current);
  assert(
    card.english_edition === true,
    "negative ID should mark English edition",
  );
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
  assert(
    resolveCalls.length === 0,
    "resolver should not run without unlinked editions",
  );
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

Deno.test("catalog Hebrew author ignores a newer English edition", async () => {
  const seed = work("seed", 1, [100]);
  const candidate = work("candidate", 100);
  candidate.original_authors = ["Taylor Jenkins Reid"];
  const catalogWork = work("catalog", 9999);
  catalogWork.original_authors = ["Taylor Jenkins Reid"];
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate, catalogWork],
    [],
    [
      {
        ...linkedEdition(-474156, "catalog", "2026-11-05T00:00:00Z"),
        author: "Taylor Jenkins Reid",
      },
      {
        ...linkedEdition(1006655, "catalog", "2026-10-01T00:00:00Z"),
        author: "טיילור ג'נקינס-ריד",
      },
    ],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => "לא אמור להיקרא",
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(
    payload.recommendations[0].hebrew_author === "טיילור ג'נקינס-ריד",
    "positive-ID Hebrew edition should supply the catalog author",
  );
});

Deno.test("catalog Hebrew author works with the shared localization fake", async () => {
  const db = new SharedFakeDb({
    works: [{
      id: "catalog",
      original_authors: ["Taylor Jenkins Reid"],
    }],
    editions: [
      {
        simania_id: -474156,
        work_id: "catalog",
        author: "Taylor Jenkins Reid",
        resolved_at: "2026-11-05T00:00:00Z",
      },
      {
        simania_id: 1006655,
        work_id: "catalog",
        author: "טיילור ג'נקינס-ריד",
        resolved_at: "2026-10-01T00:00:00Z",
      },
    ],
  });
  let wikidataCalled = false;
  const result = await hebrewAuthorFor(
    db as never,
    "Taylor Jenkins Reid",
    {
      wikidataHebrewAuthor: async () => {
        wikidataCalled = true;
        return null;
      },
    },
    new Map(),
  );
  assert(
    result === "טיילור ג'נקינס-ריד",
    "shared fake should return the positive-ID catalog author",
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
  assert(
    payload.recommendations[0].hebrew_author === null,
    "expected null author",
  );
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
  assert(
    payload.recommendations[0].simania_id === 777,
    "expected localized card",
  );
  assert(
    payload.recommendations[0].hardcover_id === 100,
    "expected Hardcover ID",
  );
  assert(
    payload.recommendations[0].can_add === true,
    "localized card should be addable",
  );
  assert(
    payload.recommendations[0].hebrew_author === null,
    "localized card should not carry hebrew_author",
  );
});

Deno.test("candidate with only an English edition stays English-only", async () => {
  const seed = work("seed", 1, [474156]);
  const candidate = work("candidate", 474156);
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate],
    [],
    [linkedEdition(-474156, "candidate", "2026-11-05T00:00:00Z")],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    hebrewHint: async () => null,
    wikidataHebrewAuthor: async () => null,
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(
    db.replacement?.[0].simania_id === null,
    "replacement row must not reference the English edition",
  );
  assert(
    payload.recommendations[0].simania_id === null &&
      payload.recommendations[0].english_only === true,
    "card should stay English-only",
  );
});

Deno.test("candidate with English and Hebrew editions uses the Hebrew edition", async () => {
  const seed = work("seed", 1, [474156]);
  const candidate = work("candidate", 474156);
  const db = new FakeDb(
    [shelfBook(11, "read", seed, { rating: 5 })],
    [seed, candidate],
    [],
    [
      linkedEdition(-474156, "candidate", "2026-11-05T00:00:00Z"),
      linkedEdition(1234, "candidate", "2026-10-01T00:00:00Z"),
    ],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    wikidataHebrewAuthor: async () => null,
  });
  const payload = await response.json();
  assert(response.status === 200, "expected 200");
  assert(
    db.replacement?.[0].simania_id === 1234 &&
      payload.recommendations[0].simania_id === 1234,
    "positive-ID Hebrew edition should be selected",
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
