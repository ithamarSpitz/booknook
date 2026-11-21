import type { Sql } from "npm:postgres@3.4.5";
import {
  authors,
  type HardcoverBook,
} from "../supabase/functions/_shared/hardcover.ts";
import {
  bookDetails,
  type SimaniaBookDetails,
} from "../supabase/functions/_shared/simania.ts";
import {
  similarity,
  stripHebrewPoints,
} from "../supabase/functions/_shared/utils.ts";
import { checkHardcoverBudget } from "./lib/hardcover-budget.ts";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";
import {
  applyRepair,
  type LinkRepairPlan,
  type RepairResult,
} from "./repair-links.ts";

const USAGE =
  "Usage: series:links [--apply] [--simania <id>] [--min-hardcover <n>] [--force-hardcover]";
const HARDCOVER = "https://api.hardcover.app/v1/graphql";

export const AUTHOR_DICE = 0.45;
export const TITLE_DICE = 0.8;
export const MIN_READERS = 5;
export const READER_RATIO = 3;
export const AUTHOR_AGREEMENT = 0.6;

export interface SeriesTarget {
  simania_id: number;
  title: string;
  author: string | null;
  series: string;
}

export interface LinkedAnchor {
  simania_id: number;
  author: string | null;
  hardcover_id: number;
  original_authors: string[];
}

export interface BookSeriesRow {
  position: number | null;
  series_id: number;
}

export interface SeriesAnchor {
  simania_id: number;
  number: number;
  rows: BookSeriesRow[];
  authors: string[];
}

export type SeriesBook = HardcoverBook & { compilation?: boolean | null };

export type SeriesDecision =
  | { series_id: number }
  | { reason: "no_anchor" | "anchor_disagrees" | "ambiguous_series" };

export type BookDecision =
  | { book: SeriesBook }
  | { reason: "no_book" | "ambiguous_book" };

/** Pick the one Hardcover series every anchor agrees on. */
export function acceptSeries(anchors: SeriesAnchor[]): SeriesDecision {
  const seriesIds = new Set<number>();
  for (const anchor of anchors) {
    for (const row of anchor.rows) seriesIds.add(row.series_id);
  }
  const accepted: number[] = [];
  let disagreed = false;
  for (const id of seriesIds) {
    let agrees = false;
    let disagrees = false;
    for (const anchor of anchors) {
      for (const row of anchor.rows) {
        if (row.series_id !== id) continue;
        if (row.position === anchor.number) agrees = true;
        else disagrees = true;
      }
    }
    if (agrees && disagrees) disagreed = true;
    else if (agrees) accepted.push(id);
  }
  if (accepted.length > 1) return { reason: "ambiguous_series" };
  if (accepted.length === 1) return { series_id: accepted[0] };
  return { reason: disagreed ? "anchor_disagrees" : "no_anchor" };
}

/** Pick the one book at a series position, or say why that is not possible. */
export function pickBook(
  books: SeriesBook[],
  anchorAuthors: string[],
): BookDecision {
  const kept = books.filter((book) =>
    !book.compilation &&
    authors(book).some((name) =>
      anchorAuthors.some((anchor) => similarity(name, anchor) > AUTHOR_DICE)
    )
  );
  const ranked = [...kept].sort((a, b) =>
    (b.users_read_count ?? 0) - (a.users_read_count ?? 0) || a.id - b.id
  );
  const top = ranked[0];
  if (!top) return { reason: "no_book" };
  const topReaders = top.users_read_count ?? 0;
  if (topReaders < MIN_READERS) return { reason: "no_book" };
  for (const other of ranked.slice(1)) {
    if (similarity(top.title, other.title) >= TITLE_DICE) continue;
    if (topReaders < READER_RATIO * (other.users_read_count ?? 0)) {
      return { reason: "ambiguous_book" };
    }
  }
  return { book: top };
}

function plainAuthor(value: string): string {
  return stripHebrewPoints(value).replace(/[()]/g, "").replace(/\s+/g, " ")
    .trim();
}

export function authorsAgree(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return plainAuthor(a) === plainAuthor(b) ||
    similarity(a, b) >= AUTHOR_AGREEMENT;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

export function targetEditions(
  sql: Sql,
  simaniaId: number | null,
): Promise<SeriesTarget[]> {
  if (simaniaId !== null) {
    return sql<SeriesTarget[]>`
      select e.simania_id, e.title, e.author, trim(e.series) as series
      from public.editions as e
      where e.simania_id > 0
        and e.resolve_status = 'not_found'
        and e.work_id is null
        and trim(coalesce(e.series, '')) <> ''
        and e.simania_id = ${simaniaId}
      order by e.simania_id
    `;
  }
  return sql<SeriesTarget[]>`
    select e.simania_id, e.title, e.author, trim(e.series) as series
    from public.editions as e
    where e.simania_id > 0
      and e.resolve_status = 'not_found'
      and e.work_id is null
      and trim(coalesce(e.series, '')) <> ''
      and (
        exists (select 1 from public.shelf_books as sb where sb.simania_id = e.simania_id)
        or exists (select 1 from public.recommendations as r where r.simania_id = e.simania_id)
        or exists (select 1 from public.genre_recommendations as g where g.simania_id = e.simania_id)
      )
    order by e.simania_id
  `;
}

export function linkedSeriesEditions(
  sql: Sql,
  series: string,
): Promise<LinkedAnchor[]> {
  return sql<LinkedAnchor[]>`
    select e.simania_id, e.author, w.hardcover_id, w.original_authors
    from public.editions as e
    inner join public.works as w on w.id = e.work_id
    where e.simania_id > 0
      and e.work_id is not null
      and trim(e.series) = ${series}
    order by e.simania_id
  `;
}

export function seriesOfBookQuery(bookId: number): string {
  return `query { book_series(where:{book_id:{_eq:${bookId}}}){ position series_id } }`;
}

export function booksAtPositionQuery(
  seriesId: number,
  position: number,
): string {
  return `query { book_series(where:{series_id:{_eq:${seriesId}}, position:{_eq:${position}}}){ book_id book { id title slug users_read_count compilation cached_contributors cached_similar_book_ids cached_tags image { url } } } }`;
}

async function hardcoverGraphql(query: string): Promise<unknown> {
  const token = Deno.env.get("HARDCOVER_API_KEY")?.trim();
  if (!token) throw new Error("HARDCOVER_API_KEY is not configured.");
  const response = await fetch(HARDCOVER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(18000),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(
      payload.errors?.[0]?.message ??
        `Hardcover returned HTTP ${response.status}.`,
    );
  }
  return payload.data;
}

function bookSeriesList(data: unknown): Record<string, unknown>[] {
  const list = (data as { book_series?: unknown } | null)?.book_series;
  return Array.isArray(list) ? list as Record<string, unknown>[] : [];
}

export interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  bookDetails: (id: number) => Promise<SimaniaBookDetails | null>;
  hardcover: (query: string) => Promise<unknown>;
  checkHardcoverBudget: typeof checkHardcoverBudget;
  applyRepair: typeof applyRepair;
  now: () => Date;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  loadOperatorEnv,
  openProdDb,
  bookDetails,
  hardcover: hardcoverGraphql,
  checkHardcoverBudget,
  applyRepair,
  now: () => new Date(),
  log: console.log,
  error: console.error,
};

interface CliOptions {
  apply: boolean;
  simaniaId: number | null;
  minHardcover: number;
  forceHardcover: boolean;
}

function parseArgs(args: string[]): CliOptions | null {
  const options: CliOptions = {
    apply: false,
    simaniaId: null,
    minHardcover: 1500,
    forceHardcover: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
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

interface Proposal {
  target: SeriesTarget;
  book: SeriesBook;
}

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
    const targets = await targetEditions(sql, options.simaniaId);
    const proposals: Proposal[] = [];
    let skipped = 0;

    // Deliberately sequential: one provider request at a time.
    for (const target of targets) {
      const skip = (
        number: number | null,
        anchors: unknown[],
        seriesId: number | null,
        reason: string,
      ) => {
        skipped++;
        deps.log(JSON.stringify({
          simania_id: target.simania_id,
          title: target.title,
          series: target.series,
          number,
          anchors,
          series_id: seriesId,
          reason,
        }));
      };

      const details = await deps.bookDetails(target.simania_id);
      const number = positiveInteger(details?.seriesNumber);
      if (number === null) {
        skip(null, [], null, "no_number");
        continue;
      }

      const anchors: SeriesAnchor[] = [];
      const candidates = (await linkedSeriesEditions(sql, target.series))
        .filter((row) => authorsAgree(row.author, target.author));
      for (const candidate of candidates) {
        const anchorDetails = await deps.bookDetails(candidate.simania_id);
        const anchorNumber = positiveInteger(anchorDetails?.seriesNumber);
        if (anchorNumber === null) continue;
        const rows = bookSeriesList(
          await deps.hardcover(seriesOfBookQuery(candidate.hardcover_id)),
        ).flatMap((row) =>
          typeof row.series_id === "number"
            ? [{
              position: typeof row.position === "number" ? row.position : null,
              series_id: row.series_id,
            }]
            : []
        );
        anchors.push({
          simania_id: candidate.simania_id,
          number: anchorNumber,
          rows,
          authors: candidate.original_authors ?? [],
        });
      }

      const decision = acceptSeries(anchors);
      const anchorLines = (seriesId: number | null) =>
        anchors.map((anchor) => ({
          simania_id: anchor.simania_id,
          number: anchor.number,
          position: anchor.rows.find((row) => row.series_id === seriesId)
            ?.position ?? null,
        }));
      if ("reason" in decision) {
        skip(number, anchorLines(null), null, decision.reason);
        continue;
      }

      const seriesId = decision.series_id;
      const anchorAuthors = anchors
        .filter((anchor) =>
          anchor.rows.some((row) => row.series_id === seriesId)
        )
        .flatMap((anchor) => anchor.authors);
      const books = bookSeriesList(
        await deps.hardcover(booksAtPositionQuery(seriesId, number)),
      ).flatMap((row) => {
        const book = row.book as SeriesBook | null | undefined;
        return book && typeof book.id === "number" ? [book] : [];
      });
      const picked = pickBook(books, anchorAuthors);
      if ("reason" in picked) {
        skip(number, anchorLines(seriesId), seriesId, picked.reason);
        continue;
      }

      proposals.push({ target, book: picked.book });
      deps.log(JSON.stringify({
        simania_id: target.simania_id,
        title: target.title,
        series: target.series,
        number,
        anchors: anchorLines(seriesId),
        series_id: seriesId,
        proposal: {
          hardcover_id: picked.book.id,
          title: picked.book.title,
          users_read_count: picked.book.users_read_count ?? 0,
        },
      }));
    }

    if (!options.apply) {
      deps.log(JSON.stringify({ proposals: proposals.length, skipped }));
      return 0;
    }

    let linked = 0;
    let failed = false;
    for (const { target, book } of proposals) {
      try {
        const plan = {
          kind: "link",
          simania_id: target.simania_id,
          title: target.title,
          author: target.author,
          translator: null,
          original_title: book.title,
          book,
          reason: "ok",
        } as unknown as LinkRepairPlan;
        const result: RepairResult = await deps.applyRepair(
          sql,
          plan,
          deps.now(),
          "series",
        );
        if (result.status === "linked") linked++;
      } catch (error) {
        failed = true;
        deps.log(JSON.stringify({
          simania_id: target.simania_id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        }));
      }
    }
    deps.log(JSON.stringify({ linked }));
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
      error instanceof Error ? error.message : "Series linking failed.",
    );
    Deno.exit(1);
  }
}
