import type { Sql } from "npm:postgres@3.4.5";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";

export interface NotFoundEdition {
  simania_id: number;
  title: string;
  author: string | null;
}

const USAGE = "Usage: requeue:not-found [--apply] [--simania <id>]";

/** Unresolved editions that some reader still references. */
export function notFoundEditions(
  sql: Sql,
  simaniaId: number | null = null,
): Promise<NotFoundEdition[]> {
  return sql<NotFoundEdition[]>`
    select e.simania_id, e.title, e.author
    from public.editions as e
    where e.simania_id > 0
      and e.resolve_status = 'not_found'
      and e.work_id is null
      and (${simaniaId}::integer is null or e.simania_id = ${simaniaId})
      and (
        exists (select 1 from public.shelf_books as sb where sb.simania_id = e.simania_id)
        or exists (select 1 from public.recommendations as r where r.simania_id = e.simania_id)
        or exists (select 1 from public.genre_recommendations as g where g.simania_id = e.simania_id)
      )
    order by e.simania_id
  `;
}

export async function requeueEditions(
  sql: Sql,
  ids: number[],
): Promise<number> {
  const rows = await sql<{ simania_id: number }[]>`
    update public.editions
    set resolve_status = 'pending', resolved_at = null
    where simania_id = any(${ids}::integer[])
      and resolve_status = 'not_found'
      and work_id is null
    returning simania_id
  `;
  return rows.length;
}

interface CliOptions {
  apply: boolean;
  simaniaId: number | null;
}

function parseArgs(args: string[]): CliOptions | null {
  let apply = false;
  let simaniaId: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--simania") {
      const value = args[++i];
      if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
      simaniaId = Number(value);
      if (!Number.isSafeInteger(simaniaId)) return null;
    } else {
      return null;
    }
  }
  return { apply, simaniaId };
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
  const options = parseArgs(args);
  if (!options) {
    deps.error(USAGE);
    return 2;
  }

  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: !options.apply });
  try {
    const editions = await notFoundEditions(sql, options.simaniaId);
    for (const edition of editions) deps.log(JSON.stringify(edition));
    if (!options.apply) {
      deps.log(JSON.stringify({ total: editions.length }));
      return 0;
    }
    const requeued = editions.length === 0
      ? 0
      : await requeueEditions(sql, editions.map((e) => e.simania_id));
    deps.log(JSON.stringify({ requeued }));
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
      error instanceof Error ? error.message : "Requeue failed.",
    );
    Deno.exit(1);
  }
}
