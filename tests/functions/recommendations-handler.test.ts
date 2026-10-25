import { handleRecommendations } from "../../supabase/functions/recommendations/index.ts";
import type { WorkRow } from "../../supabase/functions/_shared/types.ts";
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
): unknown {
  return {
    simania_id: simaniaId,
    position: 0,
    added_at: "2026-01-01T00:00:00Z",
    finished_at: null,
    shelves: { kind },
    editions: {
      title: `Seed ${simaniaId}`,
      work_id: value?.id ?? null,
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
    [shelfBook(11, "reading", seed), shelfBook(22, "want", shelved)],
    [shelved, dismissed, kept],
    ["dismissed"],
  );
  const response = await handleRecommendations(request(), {
    authenticate: async () => "user",
    userDatabase: () => db as never,
    serviceDatabase: () => db as never,
    localize: async () => null,
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
});

Deno.test("unauthenticated request returns 401", async () => {
  const response = await handleRecommendations(request(), {
    authenticate: async () => {
      throw new HttpError(401, "Authentication required.");
    },
  });
  assert(response.status === 401, "expected 401");
});
