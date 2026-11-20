import type { Sql } from "npm:postgres@3.4.5";
import { nameSoundScore } from "./lib/names.ts";
import { openProdDb } from "./lib/prod-db.ts";

export interface AuthorAuditRow {
  simania_id: number;
  title: string;
  author: string | null;
  resolve_status: string;
  hardcover_id: number | null;
  original_title: string;
  original_authors: string[];
}

export interface AuthorAuditFinding extends AuthorAuditRow {
  name_sound_score: number;
}

export interface AuthorAuditOutput {
  lines: AuthorAuditFinding[];
  totals: {
    checked: number;
    rejected: number;
    scope: AuthorAuditScope;
  };
}

export type AuthorAuditScope = "all" | "used";

type SoundScore = (hebrewName: string, latinNames: string[]) => number;

/** The browser author guard, specialized to the audit's empty Hebrew bridge. */
export function authorRowIsRejected(
  row: AuthorAuditRow,
  soundScore: SoundScore = nameSoundScore,
): boolean {
  const author = row.author ?? "";
  const nonEmptyEnglishAuthors = row.original_authors.filter((name) =>
    String(name ?? "").trim() !== ""
  );
  if (nonEmptyEnglishAuthors.length === 0) return false;
  if (nonEmptyEnglishAuthors.every((name) => /[א-ת]/u.test(name))) {
    return false;
  }
  return /[א-ת]/u.test(author) &&
    soundScore(author, nonEmptyEnglishAuthors) < 0.3;
}

/** Filter fixture or database rows using the exact guard applied by the audit. */
export function filterRejectedAuthorRows(
  rows: AuthorAuditRow[],
  soundScore: SoundScore = nameSoundScore,
): AuthorAuditRow[] {
  return rows.filter((row) => authorRowIsRejected(row, soundScore));
}

/** Build the JSON-line records and final totals without database access. */
export function buildAuditOutput(
  rows: AuthorAuditRow[],
  soundScore: SoundScore = nameSoundScore,
  scope: AuthorAuditScope = "used",
): AuthorAuditOutput {
  const rejected = filterRejectedAuthorRows(rows, soundScore);
  return {
    lines: rejected.map((row) => ({
      ...row,
      name_sound_score: soundScore(row.author ?? "", row.original_authors),
    })),
    totals: {
      checked: rows.length,
      rejected: rejected.length,
      scope,
    },
  };
}

/** Build the read-only audit query for the requested catalog scope. */
export function authorAuditQuery(scope: AuthorAuditScope = "used"): string {
  const readerUseCondition = scope === "used"
    ? `
      and (
        exists (
          select 1
          from public.shelf_books as sb
          inner join public.editions as shelved
            on shelved.simania_id = sb.simania_id
          where shelved.work_id = w.id
        )
        or exists (
          select 1
          from public.recommendations as r
          where r.work_id = w.id
        )
        or exists (
          select 1
          from public.genre_recommendations as g
          where g.work_id = w.id
        )
      )`
    : "";

  return `
    select
      e.simania_id,
      e.title,
      e.author,
      e.resolve_status::text as resolve_status,
      w.hardcover_id,
      w.original_title,
      w.original_authors
    from public.editions as e
    inner join public.works as w on w.id = e.work_id
    where e.simania_id > 0
      ${readerUseCondition}
    order by e.simania_id
  `;
}

export function authorAuditRows(
  sql: Sql,
  scope: AuthorAuditScope = "used",
): Promise<AuthorAuditRow[]> {
  return sql.unsafe<AuthorAuditRow[]>(authorAuditQuery(scope));
}

async function main(): Promise<void> {
  let sql: Sql | undefined;
  try {
    const scope: AuthorAuditScope = Deno.args.includes("--all") ? "all" : "used";
    sql = await openProdDb({ readOnly: true });
    const output = buildAuditOutput(
      await authorAuditRows(sql, scope),
      nameSoundScore,
      scope,
    );
    for (const line of output.lines) console.log(JSON.stringify(line));
    console.log(JSON.stringify({ totals: output.totals }));
  } finally {
    await sql?.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Author audit failed.",
    );
    Deno.exit(2);
  }
}
