import type { CatalogDb } from "../../../supabase/functions/_shared/catalog.ts";

type Row = Record<string, any>;
type Result = { data: any; error: any };

class Query implements PromiseLike<Result> {
  private action: "select" | "upsert" | "update" | "insert" = "select";
  private filters: Array<[string, unknown]> = [];
  private payload: Row | Row[] | null = null;
  private conflict = "id";
  private defaultToNull = true;

  constructor(private db: FakeDb, private table: string) {}

  select(_columns = "*"): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  upsert(
    payload: Row | Row[],
    options: { onConflict?: string; defaultToNull?: boolean } = {},
  ): this {
    this.action = "upsert";
    this.payload = payload;
    this.conflict = options.onConflict ?? "id";
    this.defaultToNull = options.defaultToNull ?? true;
    return this;
  }

  update(payload: Row): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  async maybeSingle(): Promise<Result> {
    const result = this.execute();
    return {
      ...result,
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
    };
  }

  async single(): Promise<Result> {
    const result = this.execute();
    return {
      ...result,
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
    };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private execute(): Result {
    if (this.action === "insert" && this.db.nextInsertError) {
      const error = this.db.nextInsertError;
      this.db.nextInsertError = null;
      return { data: null, error };
    }
    const rows = this.db.tables[this.table] ??= [];
    if (this.action === "select") {
      return { data: rows.filter((row) => this.matches(row)), error: null };
    }
    if (this.action === "update") {
      const changed = rows.filter((row) => this.matches(row));
      for (const row of changed) Object.assign(row, this.payload);
      return { data: changed.map((row) => ({ ...row })), error: null };
    }
    const incoming =
      (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
    if (this.action === "insert") {
      rows.push(...incoming.map((row) => ({ ...row })));
      return { data: incoming, error: null };
    }
    const changed: Row[] = [];
    for (const value of incoming) {
      let row = rows.find((candidate) =>
        candidate[this.conflict] === value[this.conflict]
      );
      if (row) {
        if (this.defaultToNull) {
          for (const key of Object.keys(row)) {
            if (!(key in value)) row[key] = null;
          }
        }
        Object.assign(row, value);
      } else {
        row = this.defaultToNull
          ? { ...value }
          : this.db.withDefaults(this.table, value);
        rows.push(row);
      }
      changed.push({ ...row });
    }
    return { data: changed, error: null };
  }
}

export class FakeDb implements CatalogDb {
  nextInsertError: Row | null = null;

  constructor(public tables: Record<string, Row[]> = {}) {}

  from(table: string): Query {
    return new Query(this, table);
  }

  withDefaults(table: string, row: Row): Row {
    if (table === "editions") {
      return {
        work_id: null,
        resolve_status: "pending",
        resolved_at: null,
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
        ...row,
      };
    }
    if (table === "works") return { id: "work-1", ...row };
    return { ...row };
  }
}

export function edition(overrides: Row = {}): Row {
  return {
    simania_id: 1234,
    work_id: null,
    resolve_status: "pending",
    resolved_at: null,
    title: "ספר",
    author: "סופר",
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
    ...overrides,
  };
}
