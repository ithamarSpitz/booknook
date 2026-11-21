import type { Sql } from "npm:postgres@3.4.5";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";

export interface OmnibusRow {
  simania_id: number;
  title: string;
  author: string | null;
  series: string | null;
  work_id: string | null;
  hardcover_id: number | null;
  original_title: string | null;
  original_authors: string[] | null;
  resolved_at: string | Date | null;
}

const USAGE = "Usage: report:omnibus";

export function omnibusEditions(sql: Sql): Promise<OmnibusRow[]> {
  return sql<OmnibusRow[]>`
    select e.simania_id, e.title, e.author, e.series, e.work_id,
      w.hardcover_id, w.original_title, w.original_authors, e.resolved_at
    from public.editions as e
    left join public.works as w on w.id = e.work_id
    where e.resolve_status = 'omnibus'
    order by e.resolved_at, e.simania_id
  `;
}

export interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  loadOperatorEnv,
  openProdDb,
  log: console.log,
  error: console.error,
};

/** Run the CLI and return its exit code. Exported for database-free tests. */
export async function main(
  args: string[] = Deno.args,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const deps = { ...runDefaults, ...overrides };
  if (args.length > 0) {
    deps.error(USAGE);
    return 2;
  }

  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: true });
  try {
    const rows = await omnibusEditions(sql);
    for (const r of rows) {
      deps.log(JSON.stringify({
        simania_id: r.simania_id,
        title: r.title,
        author: r.author,
        series: r.series,
        work_id: r.work_id,
        hardcover_id: r.hardcover_id,
        original_title: r.original_title,
        original_authors: r.original_authors,
        resolved_at: r.resolved_at,
      }));
    }
    deps.log(JSON.stringify({ total: rows.length }));
    return 0;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Report failed.",
    );
    Deno.exit(1);
  }
}
