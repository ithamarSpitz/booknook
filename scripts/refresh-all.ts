import type { Sql } from "npm:postgres@3.4.5";
import { fetchSimaniaPayload } from "../public/js/simania.js";
import { localizeRecommendations } from "../public/js/recs.js";
import { FUNCTIONS } from "../public/js/contract.js";
import {
  callAs,
  listReaders,
  type ProjectKeys,
  projectKeys,
  type Reader,
  readerToken,
} from "./lib/operator-session.ts";
import { openProdDb } from "./lib/prod-db.ts";

export interface ReaderCounts {
  englishRecommendations: number;
  englishGenres: number;
  bareEditions: number;
}

export interface GenreRow {
  work_id: string;
  hardcover_id: number;
  simania_id: null;
  title: string;
  author: string | null;
  cover_url: string | null;
  english_only: true;
  because: number[];
  because_titles: string[];
}

export interface BareEdition {
  simania_id: number;
  title: string;
}

export interface ReaderSummary {
  reader: string;
  englishBefore: number;
  englishAfter: number;
  genreBefore: number;
  genreAfter: number;
  booksLinked: number;
  fallbackLinked: number;
  editionsFilled: number;
  failed: number;
}

type CallAs = typeof callAs;
type FetchPayload = typeof fetchSimaniaPayload;
type Localize = typeof localizeRecommendations;

export async function countReaderRows(
  sql: Sql,
  readerId: string,
): Promise<ReaderCounts> {
  const rows = await sql<{
    english_recommendations: number;
    english_genres: number;
    bare_editions: number;
  }[]>`
    select
      (
        select count(*)::integer
        from public.recommendations
        where user_id = ${readerId}
          and dismissed = false
          and simania_id is null
      ) as english_recommendations,
      (
        select count(*)::integer
        from public.genre_recommendations
        where user_id = ${readerId}
          and simania_id is null
      ) as english_genres,
      (
        select count(*)::integer
        from public.editions as e
        where e.simania_id > 0
          and e.details_at is null
          and e.simania_id in (
            select r.simania_id
            from public.recommendations as r
            where r.user_id = ${readerId} and r.simania_id is not null
            union
            select gr.simania_id
            from public.genre_recommendations as gr
            where gr.user_id = ${readerId} and gr.simania_id is not null
            union
            select sb.simania_id
            from public.shelf_books as sb
            where sb.user_id = ${readerId}
          )
      ) as bare_editions
  `;
  const row = rows[0];
  if (!row) throw new Error("Reader count query returned no row.");
  return {
    englishRecommendations: Number(row.english_recommendations),
    englishGenres: Number(row.english_genres),
    bareEditions: Number(row.bare_editions),
  };
}

export async function listEnglishGenreRows(
  sql: Sql,
  readerId: string,
): Promise<GenreRow[]> {
  return await sql<GenreRow[]>`
    select
      gr.work_id,
      w.hardcover_id,
      null::integer as simania_id,
      w.original_title as title,
      case
        when cardinality(w.original_authors) = 0 then null
        else array_to_string(w.original_authors, ', ')
      end as author,
      w.hardcover_cover_url as cover_url,
      true as english_only,
      gr.because,
      coalesce((
        select array_agg(e.title order by seed.ordinality)
        from unnest(gr.because) with ordinality as seed(simania_id, ordinality)
        inner join public.editions as e on e.simania_id = seed.simania_id
      ), '{}') as because_titles
    from public.genre_recommendations as gr
    inner join public.works as w on w.id = gr.work_id
    where gr.user_id = ${readerId}
      and gr.simania_id is null
    order by gr.shelf_position, gr.position
  `;
}

export async function listBareEditionIds(
  sql: Sql,
  readerId: string,
): Promise<BareEdition[]> {
  const rows = await sql<BareEdition[]>`
    select e.simania_id, e.title
    from public.editions as e
    where e.simania_id > 0
      and e.details_at is null
      and e.simania_id in (
        select r.simania_id
        from public.recommendations as r
        where r.user_id = ${readerId} and r.simania_id is not null
        union
        select gr.simania_id
        from public.genre_recommendations as gr
        where gr.user_id = ${readerId} and gr.simania_id is not null
        union
        select sb.simania_id
        from public.shelf_books as sb
        where sb.user_id = ${readerId}
      )
    order by e.simania_id
  `;
  return rows.map((row) => ({
    simania_id: Number(row.simania_id),
    title: row.title,
  }));
}

interface RefreshDeps {
  keys: ProjectKeys;
  sql: Sql;
  readerToken: typeof readerToken;
  callAs: CallAs;
  fetchSimaniaPayload: FetchPayload;
  localizeRecommendations: Localize;
  countReaderRows: typeof countReaderRows;
  listEnglishGenreRows: typeof listEnglishGenreRows;
  listBareEditionIds: typeof listBareEditionIds;
  concurrency?: number;
  simaniaThrottle?: () => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  log: (message: string) => void;
}

export function createSimaniaThrottle(
  sleep: (milliseconds: number) => Promise<void>,
): () => Promise<void> {
  let started = false;
  let tail = Promise.resolve();
  return () => {
    const turn = tail.then(async () => {
      if (started) await sleep(1_000);
      started = true;
    });
    tail = turn.catch(() => {});
    return turn;
  };
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runWorker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker(),
    ),
  );
}

export class ReaderSessionError extends Error {
  constructor(public readonly reader: Reader) {
    super(`Reader session step failed for ${reader.email}.`);
    this.name = "ReaderSessionError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function errorStatus(error: unknown): number | null {
  const status = record(error)?.status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function safeErrorMessage(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/eyJ[A-Za-z0-9._~-]*/g, "[redacted]");
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  message = message.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[redacted]",
  );
  return message.slice(0, 200);
}

/** Refresh one reader in contract order. All network and database I/O is injected. */
export async function refreshReader(
  deps: RefreshDeps,
  reader: Reader,
): Promise<ReaderSummary> {
  const before = await deps.countReaderRows(deps.sql, reader.id);
  let token: string;
  try {
    token = await deps.readerToken(deps.keys, reader.email);
  } catch {
    throw new ReaderSessionError(reader);
  }

  let failed = 0;
  let recommendations: Record<string, unknown>[] = [];
  try {
    const response = record(
      await deps.callAs(deps.keys, token, FUNCTIONS.RECOMMENDATIONS, {}),
    );
    if (!Array.isArray(response?.recommendations)) {
      throw new Error("Recommendations response has an invalid shape.");
    }
    recommendations = response.recommendations.filter((item) =>
      record(item)
    ) as Record<string, unknown>[];
  } catch (error) {
    failed++;
    deps.log(JSON.stringify({
      failed: {
        title: "recommendations",
        step: "recommendations",
        function: FUNCTIONS.RECOMMENDATIONS,
        status: errorStatus(error),
        message: safeErrorMessage(error, [
          token,
          deps.keys.anonKey,
          deps.keys.serviceKey,
          reader.email,
        ]),
      },
    }));
  }

  const linkedWorks = new Set<string>();
  const fallbackLinkedWorks = new Set<string>();
  const concurrency = deps.concurrency ?? 1;
  const simaniaThrottle = deps.simaniaThrottle ??
    createSimaniaThrottle(deps.sleep);
  const throttledFetch: FetchPayload = async (simaniaId, fetchImpl) => {
    await simaniaThrottle();
    return await deps.fetchSimaniaPayload(simaniaId, fetchImpl);
  };
  const callFunction = (name: string, body: Record<string, unknown>) =>
    deps.callAs(deps.keys, token, name, body);
  const onLinked = (workId: string) => linkedWorks.add(workId);

  const reportFailure = (
    title: string,
    step: "localize" | "genre-hint" | "details",
    functionName: string,
    error: unknown,
  ) => {
    deps.log(JSON.stringify({
      failed: {
        title,
        step,
        function: functionName,
        status: errorStatus(error),
        message: safeErrorMessage(error, [
          token,
          deps.keys.anonKey,
          deps.keys.serviceKey,
          reader.email,
        ]),
      },
    }));
  };

  const localize = async (item: Record<string, unknown>) => {
    const title = typeof item.title === "string" ? item.title : "";
    let observedFailures = 0;
    const guardedCall = async (
      name: string,
      body: Record<string, unknown>,
    ) => {
      try {
        const response = await callFunction(name, body);
        if (
          name === FUNCTIONS.LINK_EDITION &&
          body.source === "nli_author" &&
          typeof body.work_id === "string" &&
          Number(record(response)?.simania_id) === Number(body.simania_id)
        ) {
          fallbackLinkedWorks.add(body.work_id);
        }
        return response;
      } catch (error) {
        observedFailures++;
        reportFailure(title, "localize", name, error);
        throw error;
      }
    };
    const guardedFetch: FetchPayload = async (simaniaId, fetchImpl) => {
      try {
        return await throttledFetch(simaniaId, fetchImpl);
      } catch (error) {
        observedFailures++;
        reportFailure(title, "localize", "simania", error);
        throw error;
      }
    };
    try {
      await deps.localizeRecommendations([item] as never, {
        callFunction: guardedCall,
        onLinked,
        isCurrent: () => true,
        fetchPayload: guardedFetch,
        concurrency: 1,
      });
    } catch (error) {
      if (observedFailures === 0) {
        observedFailures++;
        reportFailure(title, "localize", "localizeRecommendations", error);
      }
    }
    failed += observedFailures;
  };

  const localizableCards = recommendations.filter((item) =>
    item.english_only === true
  );
  await runPool(localizableCards, concurrency, localize);

  let genreRows: GenreRow[] = [];
  try {
    genreRows = await deps.listEnglishGenreRows(deps.sql, reader.id);
  } catch {
    failed++;
  }
  await runPool(genreRows, concurrency, async (row) => {
    try {
      const hint = record(
        await callFunction(FUNCTIONS.GENRE_HINT, { work_id: row.work_id }),
      );
      await localize({
        ...row,
        can_add: true,
        hebrew_hint: hint?.hebrew_hint ?? null,
        hebrew_author: hint?.hebrew_author ?? null,
      });
    } catch (error) {
      failed++;
      reportFailure(row.title, "genre-hint", FUNCTIONS.GENRE_HINT, error);
    }
  });

  let editionsFilled = 0;
  let bareEditions: BareEdition[] = [];
  try {
    bareEditions = await deps.listBareEditionIds(deps.sql, reader.id);
  } catch {
    failed++;
  }
  for (const edition of bareEditions) {
    const simaniaId = edition.simania_id;
    let functionName = "simania";
    try {
      const simania = await throttledFetch(simaniaId);
      functionName = FUNCTIONS.BOOK_DETAILS;
      await callFunction(FUNCTIONS.BOOK_DETAILS, {
        simania_id: simaniaId,
        simania,
      });
      editionsFilled++;
    } catch (error) {
      failed++;
      reportFailure(
        edition.title,
        "details",
        functionName,
        error,
      );
    }
  }

  const after = await deps.countReaderRows(deps.sql, reader.id);
  const summary: ReaderSummary = {
    reader: reader.email,
    englishBefore: before.englishRecommendations,
    englishAfter: after.englishRecommendations,
    genreBefore: before.englishGenres,
    genreAfter: after.englishGenres,
    booksLinked: linkedWorks.size,
    fallbackLinked: fallbackLinkedWorks.size,
    editionsFilled,
    failed,
  };
  deps.log(JSON.stringify(summary));
  return summary;
}

interface MainDeps {
  projectKeys: typeof projectKeys;
  listReaders: typeof listReaders;
  readerToken: typeof readerToken;
  callAs: CallAs;
  fetchSimaniaPayload: FetchPayload;
  localizeRecommendations: Localize;
  openProdDb: typeof openProdDb;
  countReaderRows: typeof countReaderRows;
  listEnglishGenreRows: typeof listEnglishGenreRows;
  listBareEditionIds: typeof listBareEditionIds;
  sleep: (milliseconds: number) => Promise<void>;
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaults: MainDeps = {
  projectKeys,
  listReaders,
  readerToken,
  callAs,
  fetchSimaniaPayload,
  localizeRecommendations,
  openProdDb,
  countReaderRows,
  listEnglishGenreRows,
  listBareEditionIds,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log: console.log,
  error: console.error,
};

/** Run the refresh CLI and return its process exit code. */
export async function main(
  args: string[] = Deno.args,
  overrides: Partial<MainDeps> = {},
): Promise<number> {
  const deps = { ...defaults, ...overrides };
  let concurrency = 4;
  const concurrencyIndexes = args.flatMap((arg, index) =>
    arg === "--concurrency" ? [index] : []
  );
  if (concurrencyIndexes.length > 0) {
    const index = concurrencyIndexes[0];
    const value = args[index + 1];
    if (
      concurrencyIndexes.length !== 1 ||
      value === undefined ||
      !/^[1-8]$/.test(value)
    ) {
      deps.error(
        "Invalid --concurrency value; expected an integer from 1 to 8.",
      );
      return 2;
    }
    concurrency = Number(value);
  }
  const simaniaThrottle = createSimaniaThrottle(deps.sleep);
  let keys: ProjectKeys;
  try {
    keys = await deps.projectKeys();
  } catch {
    deps.error("Project keys step failed.");
    return 2;
  }

  let readers: Reader[];
  try {
    readers = await deps.listReaders(keys);
  } catch {
    deps.error("Reader list step failed.");
    return 2;
  }

  let sql: Sql;
  try {
    sql = await deps.openProdDb({ readOnly: true });
  } catch {
    deps.error("Read-only database step failed.");
    return 2;
  }

  try {
    if (!args.includes("--apply")) {
      for (const reader of readers) {
        const counts = await deps.countReaderRows(sql, reader.id);
        deps.log(JSON.stringify({ reader: reader.email, before: counts }));
      }
      return 0;
    }

    for (const reader of readers) {
      try {
        await refreshReader({
          ...deps,
          keys,
          sql,
          concurrency,
          simaniaThrottle,
        }, reader);
      } catch (error) {
        if (error instanceof ReaderSessionError) {
          deps.error(error.message);
          return 2;
        }
        deps.error(`Refresh step failed for ${reader.email}.`);
      }
    }
    return 0;
  } catch {
    deps.error("Read-only count step failed.");
    return 2;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
