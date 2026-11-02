import type { CatalogDb } from "../../../supabase/functions/_shared/catalog.ts";

type Row = Record<string, any>;
type Result = { data: any; error: any };

type Filter =
  | [string, unknown]
  | ["__in__", string, unknown[]]
  | ["__neq__", string, unknown]
  | ["__notnull__", string]
  | ["__contains__", string, unknown[]];

class Query implements PromiseLike<Result> {
  private action: "select" | "upsert" | "update" | "insert" | "delete" =
    "select";
  private filters: Filter[] = [];
  private payload: Row | Row[] | null = null;
  private conflict = "id";
  private defaultToNull = true;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_columns = "*"): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push(["__neq__", column, value]);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is" && value === null) {
      this.filters.push(["__notnull__", column]);
    }
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orderBy = { column, ascending: options.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.limitN = count;
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push(["__in__", column, values]);
    return this;
  }

  contains(column: string, values: unknown[]): this {
    this.filters.push(["__contains__", column, values]);
    return this;
  }

  delete(): this {
    this.action = "delete";
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
    return this.filters.every((filter) => {
      if (filter[0] === "__in__") {
        const column = filter[1] as string;
        const values = filter[2] as unknown[];
        return values.includes(row[column]);
      }
      if (filter[0] === "__neq__") {
        const column = filter[1] as string;
        const value = filter[2];
        return row[column] !== value;
      }
      if (filter[0] === "__notnull__") {
        const column = filter[1] as string;
        return row[column] !== null && row[column] !== undefined;
      }
      if (filter[0] === "__contains__") {
        const column = filter[1] as string;
        const values = filter[2] as unknown[];
        const field = row[column];
        if (!Array.isArray(field)) return false;
        return values.every((value) => field.includes(value));
      }
      const [column, value] = filter;
      return row[column] === value;
    });
  }

  private execute(): Result {
    if (this.action === "insert" && this.db.nextInsertError) {
      const error = this.db.nextInsertError;
      this.db.nextInsertError = null;
      return { data: null, error };
    }
    const rows = this.db.tables[this.table] ??= [];
    if (this.action === "select") {
      this.db.recordSelect(this.table);
      let matched = rows.filter((row) => this.matches(row));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
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
      if (this.limitN !== null) matched = matched.slice(0, this.limitN);
      return { data: matched, error: null };
    }
    if (this.action === "update") {
      const changed = rows.filter((row) => this.matches(row));
      for (const row of changed) Object.assign(row, this.payload);
      return { data: changed.map((row) => ({ ...row })), error: null };
    }
    if (this.action === "delete") {
      const deleted = rows.filter((row) => this.matches(row));
      const kept = rows.filter((row) => !this.matches(row));
      rows.length = 0;
      rows.push(...kept);
      return { data: deleted.map((row) => ({ ...row })), error: null };
    }
    const incoming =
      (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
    if (this.action === "insert") {
      const inserted = incoming.map((row) =>
        this.table === "works" ? this.db.withDefaults(this.table, row) : { ...row }
      );
      rows.push(...inserted);
      return { data: inserted.map((row) => ({ ...row })), error: null };
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
  selectCounts: Record<string, number> = {};
  private nextWorkId = 1;

  constructor(public tables: Record<string, Row[]> = {}) {}

  from(table: string): Query {
    return new Query(this, table);
  }

  recordSelect(table: string): void {
    this.selectCounts[table] = (this.selectCounts[table] ?? 0) + 1;
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
    if (table === "works") {
      return row.id === undefined
        ? { id: `work-${this.nextWorkId++}`, ...row }
        : { ...row };
    }
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
