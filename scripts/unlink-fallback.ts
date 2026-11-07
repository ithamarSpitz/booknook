import type { Sql } from "npm:postgres@3.4.5";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";

export interface FallbackLink {
  simania_id: number;
  title: string;
  hardcover_id: number;
  original_title: string;
}

export interface UnlinkFallbackCounts {
  editions: number;
  recommendations: number;
  genre_recommendations: number;
}

export function fallbackLinks(sql: Sql): Promise<FallbackLink[]> {
  return sql<FallbackLink[]>`
    select
      e.simania_id,
      e.title,
      w.hardcover_id,
      w.original_title
    from public.editions as e
    inner join public.works as w on w.id = e.work_id
    where e.resolve_status::text = 'nli_author'
    order by e.simania_id
  `;
}

/** Unlink all matching fallback editions atomically, or one named edition. */
export async function unlinkFallback(
  sql: Sql,
  simaniaId: number | null = null,
): Promise<UnlinkFallbackCounts> {
  return await sql.begin(async (tx) => {
    const editions = await tx<{ simania_id: number }[]>`
      update public.editions
      set
        work_id = null,
        resolve_status = 'pending',
        resolved_at = null
      where resolve_status::text = 'nli_author'
        and (${simaniaId}::integer is null or simania_id = ${simaniaId})
      returning simania_id
    `;
    const editionIds = editions.map((edition) => edition.simania_id);

    const recommendations = await tx<{ simania_id: number }[]>`
      update public.recommendations
      set simania_id = null
      where simania_id = any(${editionIds}::integer[])
      returning simania_id
    `;
    const genreRecommendations = await tx<{ simania_id: number }[]>`
      update public.genre_recommendations
      set simania_id = null
      where simania_id = any(${editionIds}::integer[])
      returning simania_id
    `;

    return {
      editions: editions.length,
      recommendations: recommendations.length,
      genre_recommendations: genreRecommendations.length,
    };
  });
}

interface CliOptions {
  apply: boolean;
  simaniaId: number | null;
}

function parseArgs(args: string[]): CliOptions | null {
  if (args.length === 0) return { apply: false, simaniaId: null };
  if (args.length === 1 && args[0] === "--apply") {
    return { apply: true, simaniaId: null };
  }
  if (
    args.length === 3 && args[0] === "--apply" &&
    args[1] === "--simania" && /^[1-9]\d*$/.test(args[2])
  ) {
    const simaniaId = Number(args[2]);
    if (Number.isSafeInteger(simaniaId)) return { apply: true, simaniaId };
  }
  return null;
}

interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  fallbackLinks: typeof fallbackLinks;
  unlinkFallback: typeof unlinkFallback;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  loadOperatorEnv,
  openProdDb,
  fallbackLinks,
  unlinkFallback,
  log: console.log,
  error: console.error,
};

/** Run the CLI and return its exit code. Exported for database-free tests. */
export async function runUnlinkFallback(
  args: string[] = Deno.args,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const options = parseArgs(args);
  const deps = { ...runDefaults, ...overrides };
  if (!options) {
    deps.error("Usage: unlink:fallback [--apply [--simania <id>]]");
    return 2;
  }

  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: !options.apply });
  try {
    if (options.apply) {
      const counts = await deps.unlinkFallback(sql, options.simaniaId);
      deps.log(JSON.stringify(counts));
      return 0;
    }

    const links = await deps.fallbackLinks(sql);
    for (const link of links) deps.log(JSON.stringify(link));
    deps.log(JSON.stringify({ count: links.length }));
    return 0;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await runUnlinkFallback());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Fallback unlink failed.",
    );
    Deno.exit(1);
  }
}
