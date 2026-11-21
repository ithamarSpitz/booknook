import type { Sql } from "npm:postgres@3.4.5";
import {
  type CatalogDb,
  isBoxSet,
  matchTitle,
  resolveMatch,
} from "../supabase/functions/_shared/catalog.ts";
import type { EditionRow } from "../supabase/functions/_shared/types.ts";
import { checkHardcoverBudget } from "./lib/hardcover-budget.ts";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";
import {
  applyRepair,
  type RelinkRepairPlan,
  type RepairResult,
} from "./repair-links.ts";

const USAGE =
  "Usage: recheck:links [--apply] [--all] [--simania <id>] [--min-hardcover <n>] [--force-hardcover]";

export type RecheckStatus = "wikidata" | "nli" | "fuzzy";

export type RecheckEdition = EditionRow & {
  work_hardcover_id: number;
  work_original_title: string;
};

/** Automatic links whose work is used; every automatic link with `all`. */
export function recheckEditions(
  sql: Sql,
  options: { all: boolean; simaniaId: number | null },
): Promise<RecheckEdition[]> {
  if (options.simaniaId !== null) {
    return sql<RecheckEdition[]>`
      select e.*, w.hardcover_id as work_hardcover_id,
        w.original_title as work_original_title
      from public.editions as e
      inner join public.works as w on w.id = e.work_id
      where e.simania_id > 0
        and e.work_id is not null
        and e.resolve_status in ('wikidata', 'nli', 'fuzzy')
        and e.simania_id = ${options.simaniaId}
      order by e.simania_id
    `;
  }
  if (options.all) {
    return sql<RecheckEdition[]>`
      select e.*, w.hardcover_id as work_hardcover_id,
        w.original_title as work_original_title
      from public.editions as e
      inner join public.works as w on w.id = e.work_id
      where e.simania_id > 0
        and e.work_id is not null
        and e.resolve_status in ('wikidata', 'nli', 'fuzzy')
      order by e.simania_id
    `;
  }
  return sql<RecheckEdition[]>`
    select e.*, w.hardcover_id as work_hardcover_id,
      w.original_title as work_original_title
    from public.editions as e
    inner join public.works as w on w.id = e.work_id
    where e.simania_id > 0
      and e.work_id is not null
      and e.resolve_status in ('wikidata', 'nli', 'fuzzy')
      and (
        exists (select 1 from public.shelf_books as sb where sb.simania_id = e.simania_id)
        or exists (select 1 from public.recommendations as r where r.simania_id = e.simania_id or r.work_id = e.work_id)
        or exists (select 1 from public.genre_recommendations as g where g.simania_id = e.simania_id or g.work_id = e.work_id)
      )
    order by e.simania_id
  `;
}

/**
 * Read-only adapter that answers the two queries `resolveMatch` makes through
 * the catalog database interface (English author hint lookups).
 */
export function serviceCatalogDb(sql: Sql): CatalogDb {
  return {
    from(table: string) {
      const filters: Record<string, unknown[]> = {};
      const builder: Record<string, unknown> = {};
      for (
        const name of ["select", "eq", "neq", "not", "in", "order", "limit"]
      ) {
        builder[name] = (...args: unknown[]) => {
          filters[name] = args;
          return builder;
        };
      }
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const run = async () => {
          if (table === "editions") {
            const author = filters.eq[1] as string;
            const except = filters.neq[1] as number;
            const data = await sql`
              select work_id from public.editions
              where author = ${author} and work_id is not null
                and simania_id <> ${except}
              order by resolved_at desc nulls last
              limit 5
            `;
            return { data, error: null };
          }
          if (table === "works") {
            const ids = filters.in[1] as string[];
            const data = await sql`
              select id, original_authors from public.works
              where id = any(${ids}::uuid[])
            `;
            return { data, error: null };
          }
          return { data: [], error: null };
        };
        return run().catch((error) => ({
          data: null,
          error: { message: error instanceof Error ? error.message : "failed" },
        })).then(resolve, reject);
      };
      return builder;
    },
  };
}

export interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  resolveMatch: (
    db: CatalogDb,
    edition: EditionRow,
  ) => ReturnType<typeof resolveMatch>;
  applyRepair: (
    sql: Sql,
    plan: RelinkRepairPlan,
    now: Date,
    status: RecheckStatus,
  ) => Promise<RepairResult>;
  checkHardcoverBudget: typeof checkHardcoverBudget;
  now: () => Date;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  loadOperatorEnv,
  openProdDb,
  resolveMatch: (db, edition) => resolveMatch(db, edition),
  applyRepair: applyRepair as unknown as RunDeps["applyRepair"],
  checkHardcoverBudget,
  now: () => new Date(),
  log: console.log,
  error: console.error,
};

interface CliOptions {
  apply: boolean;
  all: boolean;
  simaniaId: number | null;
  minHardcover: number;
  forceHardcover: boolean;
}

function parseArgs(args: string[]): CliOptions | null {
  const options: CliOptions = {
    apply: false,
    all: false,
    simaniaId: null,
    minHardcover: 1500,
    forceHardcover: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--force-hardcover") options.forceHardcover = true;
    else if (arg === "--simania" || arg === "--min-hardcover") {
      const value = args[++i];
      const pattern = arg === "--simania" ? /^[1-9]\d*$/ : /^\d+$/;
      if (value === undefined || !pattern.test(value)) return null;
      const number = Number(value);
      if (!Number.isSafeInteger(number)) return null;
      if (arg === "--simania") options.simaniaId = number;
      else options.minHardcover = number;
    } else return null;
  }
  return options;
}

type Change =
  | { kind: "relink"; plan: RelinkRepairPlan; status: RecheckStatus }
  | { kind: "unlink"; simania_id: number; work_id: string };

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

  const budgetOkay = await deps.checkHardcoverBudget({
    min: options.minHardcover,
    force: options.forceHardcover,
    log: deps.log,
  });
  if (!budgetOkay) return 4;

  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: !options.apply });
  try {
    const editions = await recheckEditions(sql, options);
    const db = serviceCatalogDb(sql);
    const changes: Change[] = [];
    let checked = 0;
    let relinks = 0;
    let unlinks = 0;

    // Deliberately sequential: one provider request at a time.
    for (const edition of editions) {
      checked++;
      const resolved = await deps.resolveMatch(db, edition);
      if (resolved.failed) {
        deps.log(JSON.stringify({
          simania_id: edition.simania_id,
          skipped: "provider_failure",
        }));
        continue;
      }
      const found = resolved.found;
      if (found) {
        if (found.book.id === edition.work_hardcover_id) continue;
        relinks++;
        deps.log(JSON.stringify({
          action: "relink",
          simania_id: edition.simania_id,
          title: edition.title,
          from: {
            hardcover_id: edition.work_hardcover_id,
            original_title: edition.work_original_title,
          },
          to: { hardcover_id: found.book.id, title: found.book.title },
          status: found.status,
        }));
        changes.push({
          kind: "relink",
          status: found.status,
          plan: {
            kind: "relink",
            simania_id: edition.simania_id,
            work_id: edition.work_id as string,
            title: edition.title,
            author: edition.author,
            hardcover_id: edition.work_hardcover_id,
            original_title: edition.work_original_title,
            original_authors: [],
            book: found.book,
            proposal: { book: found.book, original_title: found.book.title },
          } as unknown as RelinkRepairPlan,
        });
      } else if (isBoxSet(matchTitle(edition.title))) {
        unlinks++;
        deps.log(JSON.stringify({
          action: "unlink",
          simania_id: edition.simania_id,
          title: edition.title,
          from: {
            hardcover_id: edition.work_hardcover_id,
            original_title: edition.work_original_title,
          },
        }));
        changes.push({
          kind: "unlink",
          simania_id: edition.simania_id,
          work_id: edition.work_id as string,
        });
      }
    }

    if (!options.apply) {
      deps.log(JSON.stringify({ checked, relinks, unlinks }));
      return 0;
    }

    let relinked = 0;
    let unlinked = 0;
    let skipped = 0;
    let failed = false;
    for (const change of changes) {
      const id = change.kind === "relink"
        ? change.plan.simania_id
        : change.simania_id;
      try {
        if (change.kind === "relink") {
          const result = await deps.applyRepair(
            sql,
            change.plan,
            deps.now(),
            change.status,
          );
          if (result.status === "linked") relinked++;
          else skipped++;
        } else {
          const rows = await sql<{ simania_id: number }[]>`
            update public.editions
            set work_id = null,
              resolve_status = 'not_found',
              resolved_at = ${deps.now()}
            where simania_id = ${change.simania_id}
              and work_id = ${change.work_id}
            returning simania_id
          `;
          if (rows.length > 0) unlinked++;
          else skipped++;
        }
      } catch (error) {
        failed = true;
        deps.log(JSON.stringify({
          simania_id: id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        }));
      }
    }
    deps.log(JSON.stringify({ relinked, unlinked, skipped }));
    return failed ? 1 : 0;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Recheck links failed.",
    );
    Deno.exit(1);
  }
}
