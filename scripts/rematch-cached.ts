import {
  normalize,
  setProviderRetry,
} from "../supabase/functions/_shared/utils.ts";
import { setProviderRetry as setSimaniaRetry } from "../public/js/simania.js";
import type { Sql } from "npm:postgres@3.4.5";
import {
  type CatalogDb,
  type CatalogProviders,
  type FailureProvider,
  type ProviderFailure,
  resolveMatch,
  type ResolveTraceEvent,
  type ResolveTraceStop,
} from "../supabase/functions/_shared/catalog.ts";
import {
  nliHebrew,
  nliOriginal,
  wikidataHebrew,
  wikidataHebrewAuthors,
  wikidataOriginals,
  wiktionaryGlosses,
} from "../supabase/functions/_shared/bridges.ts";
import {
  authors,
  findHardcoverBook,
  type HardcoverBook,
  hardcoverBooks,
  hardcoverHebrewEdition,
  isSearchDocumentBook,
} from "../supabase/functions/_shared/hardcover.ts";
import {
  bookDetails,
  fetchEditionDetails,
  searchBooks,
} from "../supabase/functions/_shared/simania.ts";
import {
  type AuthorStore,
  nameKey,
  soundNames,
} from "../supabase/functions/_shared/authors.ts";
import { hebrewAuthorBySound } from "../supabase/functions/_shared/author-sound.ts";
import { sqlAuthorStore } from "./lib/author-store.ts";
import { defaultHebrewHint } from "../supabase/functions/recommendations/index.ts";
import type { EditionRow } from "../supabase/functions/_shared/types.ts";
import { matchHebrewBook, simaniaIdOf } from "../public/js/simania.js";
import {
  checkHardcoverBudget,
  hardcoverDailyRemaining,
} from "./lib/hardcover-budget.ts";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";
import {
  authorAgreesWithWork,
  confirmCandidate,
  findCandidates,
  type RematchDeps,
  type RematchWork,
} from "./lib/rematch.ts";
import { pickByDictionary } from "./lib/dictionary.ts";
import {
  pendingHosts,
  throttledProviderFetch,
} from "./lib/provider-throttle.ts";
import { cachedFetch, type CacheStats } from "./lib/provider-cache.ts";
import { nliEnglishMismatch } from "./lib/nli-english-mismatch.ts";
import { decideMissedTranslation } from "./measure-links.ts";
import { serviceCatalogDb } from "./recheck-links.ts";
import {
  applyRepair,
  type LinkRepairPlan,
  type RepairResult,
} from "./repair-links.ts";

const USAGE =
  "Usage: rematch:cached [--apply] [--hebrew] [--explain] [--hardcover-id <id>] [--offset <n>] [--limit <n>] [--from <path>] [--cache-dir <dir>] [--min-hardcover <n>] [--force-hardcover] [--concurrency <1-4>] [--work-timeout <30-3600>]";

const BUDGET_CHECK_EVERY = 50;
const PROGRESS_EVERY = 25;

function failureDetail(
  provider: FailureProvider,
  error: unknown,
): ProviderFailure {
  return {
    provider,
    error: String((error as Error)?.message ?? error).slice(0, 200),
  };
}

class ProviderCallError extends Error {
  constructor(
    readonly provider: FailureProvider,
    readonly original: unknown,
  ) {
    super(String((original as Error)?.message ?? original));
    this.name = "ProviderCallError";
  }
}

async function identifyProvider<T>(
  provider: FailureProvider,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new ProviderCallError(provider, error);
  }
}

type MemoOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; failures: [FailureProvider, unknown][] };

/** Share one in-flight computation per key; every caller records failures. */
async function memoized<T>(
  map: Map<string, Promise<MemoOutcome<T>>>,
  key: string,
  remember: (provider: FailureProvider, error: unknown) => void,
  compute: (
    note: (provider: FailureProvider, error: unknown) => void,
  ) => Promise<T>,
): Promise<T> {
  let cached = map.get(key);
  if (!cached) {
    const entry = (async (): Promise<MemoOutcome<T>> => {
      const failures: [FailureProvider, unknown][] = [];
      try {
        return {
          ok: true,
          value: await compute((provider, error) =>
            failures.push([provider, error])
          ),
        };
      } catch (error) {
        return { ok: false, error, failures };
      }
    })();
    cached = entry;
    map.set(key, entry);
    entry.then((outcome) => {
      if (!outcome.ok && map.get(key) === entry) map.delete(key);
    });
  }
  const outcome = await cached;
  if (outcome.ok) return outcome.value;
  for (const [provider, error] of outcome.failures) remember(provider, error);
  throw outcome.error;
}

export type RematchStatus = "wikidata" | "nli" | "fuzzy" | "dictionary";

export interface RunDeps {
  /** Starts a timer; returns its cancel function. Tests inject a fake clock. */
  setTimer: (fn: () => void, ms: number) => () => void;
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  loadWorks: (
    sql: Sql,
    options: {
      hardcoverId: number | null;
      offset: number;
      limit: number | null;
    },
  ) => Promise<RematchWork[]>;
  loadUnlinkedEditions: (sql: Sql) => Promise<EditionRow[]>;
  authorStore: (sql: Sql) => AuthorStore;
  loadLinkedSimaniaIds: (sql: Sql) => Promise<Set<number>>;
  loadEdition: (sql: Sql, simaniaId: number) => Promise<EditionRow | null>;
  loadLinkedWork: (
    sql: Sql,
    simaniaId: number,
  ) => Promise<
    {
      hardcover_id: number;
      original_title: string;
      original_authors: string[] | null;
    } | null
  >;
  insertEdition: (sql: Sql, edition: EditionRow) => Promise<void>;
  wikidataHebrewAuthors: (names: string[]) => Promise<Map<string, string[]>>;
  wikidataOriginals: (titles: string[]) => Promise<Map<string, string[]>>;
  nliOriginal: (
    title: string,
    author: string,
  ) => Promise<{ title: string } | null>;
  wiktionaryGlosses: (word: string) => Promise<string[]>;
  hebrewHint: (
    book: HardcoverBook,
  ) => Promise<{ title: string; author?: string | null } | null>;
  matchHebrewBook: (title: string, author: string) => Promise<unknown>;
  searchBooks: RematchDeps["searchBooks"];
  hebrewAuthorBySound: (englishName: string) => Promise<string | null>;
  bookDetails: typeof bookDetails;
  fetchEditionDetails: (id: number) => Promise<Record<string, unknown>>;
  resolveMatch: (
    db: CatalogDb,
    edition: EditionRow,
    overrides?: Partial<CatalogProviders>,
  ) => ReturnType<typeof resolveMatch>;
  findHardcoverBook: typeof findHardcoverBook;
  applyRepair: (
    sql: Sql,
    plan: LinkRepairPlan,
    now: Date,
    status: RematchStatus,
  ) => Promise<RepairResult>;
  hardcoverBooks: (ids: number[]) => Promise<HardcoverBook[]>;
  isSearchDocumentBook: (book: HardcoverBook) => boolean;
  hardcoverDailyRemaining: () => Promise<number | null>;
  checkHardcoverBudget: typeof checkHardcoverBudget;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  readTextFile: (path: string) => Promise<string>;
  log: (message: string) => void;
  error: (message: string) => void;
}

async function loadWorks(
  sql: Sql,
  options: { hardcoverId: number | null; offset: number; limit: number | null },
): Promise<RematchWork[]> {
  const only = options.hardcoverId === null
    ? sql``
    : sql`and w.hardcover_id = ${options.hardcoverId}`;
  return await sql<RematchWork[]>`
    select w.id, w.hardcover_id, w.original_title, w.original_authors
    from public.works as w
    where not exists (
      select 1 from public.editions as e
      where e.work_id = w.id and e.simania_id > 0
    ) ${only}
    order by w.id
    offset ${options.offset}
    limit ${options.limit}
  `;
}

const runDefaults: RunDeps = {
  setTimer: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  loadOperatorEnv,
  openProdDb,
  loadWorks,
  loadUnlinkedEditions: (sql) =>
    sql<EditionRow[]>`
      select * from public.editions
      where simania_id > 0 and work_id is null
      order by simania_id
    `,
  authorStore: (sql) => sqlAuthorStore(sql),
  loadLinkedSimaniaIds: async (sql) => {
    const rows = await sql<{ simania_id: number }[]>`
      select simania_id from public.editions
      where simania_id > 0 and work_id is not null
    `;
    return new Set(rows.map((row) => Number(row.simania_id)));
  },
  loadEdition: async (sql, simaniaId) => {
    const rows = await sql<EditionRow[]>`
      select * from public.editions where simania_id = ${simaniaId}
    `;
    return rows[0] ?? null;
  },
  loadLinkedWork: async (sql, simaniaId) => {
    const rows = await sql<
      {
        hardcover_id: number;
        original_title: string;
        original_authors: string[] | null;
      }[]
    >`
      select w.hardcover_id, w.original_title, w.original_authors
      from public.editions as e
      join public.works as w on w.id = e.work_id
      where e.simania_id = ${simaniaId}
    `;
    return rows[0] ?? null;
  },
  insertEdition: async (sql, e) => {
    await sql`
      insert into public.editions (
        simania_id, resolve_status, title, author, translator, publisher,
        series, category, year, pages, description, cover_url,
        simania_rating, simania_rating_count, details_at
      ) values (
        ${e.simania_id}, 'pending', ${e.title}, ${e.author}, ${e.translator},
        ${e.publisher}, ${e.series}, ${e.category}, ${e.year}, ${e.pages},
        ${e.description}, ${e.cover_url}, ${e.simania_rating},
        ${e.simania_rating_count}, ${e.details_at}
      )
      on conflict (simania_id) do nothing
    `;
  },
  wikidataHebrewAuthors,
  wikidataOriginals,
  nliOriginal,
  wiktionaryGlosses,
  hebrewHint: (book) =>
    defaultHebrewHint(book, {
      wikidataHebrew: (title, author) =>
        identifyProvider(
          "wikidata",
          () => wikidataHebrew(title, author),
        ),
      nliHebrew: (title, author) =>
        identifyProvider("nli", () => nliHebrew(title, author)),
      hardcoverHebrewEdition: (bookId) =>
        identifyProvider(
          "hardcover",
          () => hardcoverHebrewEdition(bookId),
        ),
    }),
  matchHebrewBook: (title, author) => matchHebrewBook(title, author),
  searchBooks,
  hebrewAuthorBySound: (englishName) =>
    hebrewAuthorBySound(englishName, searchBooks),
  bookDetails,
  fetchEditionDetails,
  resolveMatch: (db, edition, overrides) =>
    resolveMatch(db, edition, overrides),
  findHardcoverBook: (title, author, options) =>
    findHardcoverBook(title, author, options),
  applyRepair: applyRepair as unknown as RunDeps["applyRepair"],
  hardcoverBooks,
  isSearchDocumentBook,
  hardcoverDailyRemaining: () => hardcoverDailyRemaining(),
  checkHardcoverBudget,
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  readTextFile: (path) => Deno.readTextFile(path),
  log: console.log,
  error: console.error,
};

interface CliOptions {
  apply: boolean;
  hebrew: boolean;
  explain: boolean;
  hardcoverId: number | null;
  offset: number;
  limit: number | null;
  minHardcover: number;
  forceHardcover: boolean;
  from: string | null;
  cacheDir: string | null;
  concurrency: number;
  workTimeout: number;
}

function parseArgs(args: string[]): CliOptions | null {
  const options: CliOptions = {
    apply: false,
    hebrew: false,
    explain: false,
    hardcoverId: null,
    offset: 0,
    limit: null,
    minHardcover: 1500,
    forceHardcover: false,
    from: null,
    cacheDir: null,
    concurrency: 1,
    workTimeout: 600,
  };
  let usedOthers = false;
  let usedConcurrency = false;
  let usedTimeout = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--hebrew") options.hebrew = true;
    else if (arg === "--explain") options.explain = true;
    else if (arg === "--force-hardcover") options.forceHardcover = true;
    else if (arg === "--concurrency") {
      const value = args[++i];
      if (value === undefined || !/^[1-4]$/.test(value)) return null;
      options.concurrency = Number(value);
      usedConcurrency = true;
    } else if (arg === "--work-timeout") {
      const value = args[++i];
      if (value === undefined || !/^\d+$/.test(value)) return null;
      const seconds = Number(value);
      if (seconds < 30 || seconds > 3600) return null;
      options.workTimeout = seconds;
      usedTimeout = true;
    } else if (arg === "--cache-dir") {
      const value = args[++i];
      if (value === undefined || value === "") return null;
      options.cacheDir = value;
    } else if (arg === "--from") {
      const value = args[++i];
      if (value === undefined || value === "") return null;
      options.from = value;
    } else if (
      arg === "--hardcover-id" || arg === "--offset" || arg === "--limit" ||
      arg === "--min-hardcover"
    ) {
      const value = args[++i];
      const pattern = arg === "--hardcover-id" || arg === "--limit"
        ? /^[1-9]\d*$/
        : /^\d+$/;
      if (value === undefined || !pattern.test(value)) return null;
      const number = Number(value);
      if (!Number.isSafeInteger(number)) return null;
      if (arg === "--hardcover-id") options.hardcoverId = number;
      else if (arg === "--offset") options.offset = number;
      else if (arg === "--limit") options.limit = number;
      else options.minHardcover = number;
      if (arg !== "--min-hardcover") usedOthers = true;
    } else return null;
  }
  if (options.from !== null && (usedOthers || usedTimeout)) return null;
  if (
    usedConcurrency &&
    (options.hebrew || options.from !== null || options.hardcoverId !== null)
  ) return null;
  if (options.explain && !options.hebrew) return null;
  if (
    options.hebrew &&
    (options.apply || options.from !== null || options.hardcoverId !== null)
  ) return null;
  return options;
}

type ResolveExplain = {
  translator: string | null;
  original: { title: string; source: string } | null;
  english_author: { name: string; source: string } | null;
  hardcover_queries: Array<{
    query: string;
    results: number;
    best_title: string | null;
    best_score: number | null;
  }>;
  stop: ResolveTraceStop | null;
};

function collectExplain(explain: ResolveExplain, event: ResolveTraceEvent) {
  if (event.type === "original") {
    explain.original = { title: event.title, source: event.source };
  } else if (event.type === "english_author") {
    explain.english_author = { name: event.name, source: event.source };
  } else if (event.type === "hardcover_query") {
    if (explain.hardcover_queries.length < 6) {
      explain.hardcover_queries.push({
        query: event.query,
        results: event.results,
        best_title: event.best_title,
        best_score: event.best_score,
      });
    }
  } else {
    explain.stop = event.stop;
  }
}

function toEditionRow(details: Record<string, unknown>): EditionRow {
  const text = (key: string) => (details[key] as string | null) ?? null;
  const num = (key: string) => (details[key] as number | null) ?? null;
  return {
    simania_id: details.simania_id as number,
    work_id: null,
    resolve_status: "pending",
    resolved_at: null,
    title: details.title as string,
    author: text("author"),
    translator: text("translator"),
    publisher: text("publisher"),
    series: text("series"),
    category: text("category"),
    year: num("year"),
    pages: num("pages"),
    description: text("description"),
    cover_url: text("cover_url"),
    simania_rating: num("simania_rating"),
    simania_rating_count: num("simania_rating_count"),
    details_at: text("details_at"),
  };
}

type Proposal = {
  work: RematchWork;
  edition: EditionRow;
  existed: boolean;
  via: "forward" | "reverse" | "dictionary" | "author_books";
  status: RematchStatus;
  book: HardcoverBook;
};

interface SavedProposal {
  simania_id: number;
  book_id: number;
  status: RematchStatus;
  work_title: string | null;
}

function parseSavedProposals(text: string): SavedProposal[] {
  const found: SavedProposal[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const savedLine = value as {
      title?: unknown;
      proposal?: Record<string, unknown>;
    } | null;
    const proposal = savedLine?.proposal;
    if (!proposal || typeof proposal !== "object") continue;
    const { simania_id, book_id, status } = proposal;
    if (
      typeof simania_id === "number" && typeof book_id === "number" &&
      (status === "wikidata" || status === "nli" || status === "fuzzy" ||
        status === "dictionary")
    ) {
      found.push({
        simania_id,
        book_id,
        status,
        work_title: typeof savedLine?.title === "string"
          ? savedLine.title
          : null,
      });
    }
  }
  return found;
}

async function proposalHasEnglishMismatch(
  deps: RunDeps,
  edition: EditionRow,
  workTitle: string,
): Promise<boolean> {
  try {
    const original = await deps.nliOriginal(
      edition.title,
      edition.author ?? "",
    );
    return original !== null && nliEnglishMismatch(workTitle, original.title);
  } catch {
    return false;
  }
}

const TIMED_OUT = Symbol("timed out");

/**
 * Runs `run` under a deadline; a late settlement is ignored by the caller.
 * `run` gets `assertLive`, which throws once the deadline fired: call it
 * before every database write so an expired work cannot change state.
 */
async function withDeadline<T>(
  deps: RunDeps,
  seconds: number,
  run: (assertLive: () => void) => Promise<T>,
): Promise<T | { deadline: ProviderFailure }> {
  let cancel = () => {};
  let expired = false;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    cancel = deps.setTimer(() => {
      expired = true;
      resolve(TIMED_OUT);
    }, seconds * 1000);
  });
  const work = run(() => {
    if (expired) throw new Error("work deadline expired");
  });
  work.catch(() => {});
  try {
    const result = await Promise.race([work, timeout]);
    if (result !== TIMED_OUT) return result as T;
    return {
      deadline: {
        provider: "deadline",
        error: `${seconds} s; pending: ${pendingHosts().join(",")}`,
      } as unknown as ProviderFailure,
    };
  } finally {
    cancel();
  }
}

async function runFromFile(
  deps: RunDeps,
  sql: Sql,
  options: CliOptions,
): Promise<number> {
  const saved = parseSavedProposals(await deps.readTextFile(options.from!));
  const ids = [...new Set(saved.map((p) => p.book_id))];
  const books = new Map<number, HardcoverBook>();
  for (let i = 0; i < ids.length; i += 50) {
    try {
      for (const book of await deps.hardcoverBooks(ids.slice(i, i + 50))) {
        books.set(book.id, book);
      }
    } catch {
      // Proposals of this chunk are reported as details_failure below.
    }
  }

  const skipped: Record<string, number> = {};
  const skip = (simania_id: number, book_id: number, reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    deps.log(JSON.stringify({ simania_id, book_id, skipped: reason }));
  };
  let linked = 0;
  let failed = false;
  const store = deps.authorStore(sql);

  const knownHebrewNames = async (englishAuthors: string[]) => {
    const names: string[] = [];
    for (const author of englishAuthors) {
      const key = nameKey(author);
      if (!key) continue;
      const found = await store.find("en", key);
      for (const row of found?.names ?? []) {
        if (row.lang === "he" && !names.includes(row.name)) {
          names.push(row.name);
        }
      }
    }
    return names;
  };

  for (const item of saved) {
    const { simania_id, book_id } = item;
    try {
      const book = books.get(book_id);
      if (!book) {
        skip(simania_id, book_id, "details_failure");
        continue;
      }
      let edition = await deps.loadEdition(sql, simania_id);
      if (edition?.work_id) {
        skip(simania_id, book_id, "linked_elsewhere");
        continue;
      }
      const existed = edition !== null;
      if (!edition) {
        edition = toEditionRow(await deps.fetchEditionDetails(simania_id));
      }
      const englishAuthors = authors(book);
      const authorAgrees = authorAgreesWithWork(
        edition.author ?? "",
        englishAuthors,
        await knownHebrewNames(englishAuthors),
      );
      if (!authorAgrees) {
        skip(simania_id, book_id, "author_mismatch");
        continue;
      }
      if (
        options.apply &&
        await proposalHasEnglishMismatch(
          deps,
          edition,
          item.work_title ?? book.title,
        )
      ) {
        skip(simania_id, book_id, "nli_english_mismatch");
        continue;
      }
      if (options.apply) {
        if (!existed) await deps.insertEdition(sql, edition);
        const plan = {
          kind: "link",
          simania_id,
          title: edition.title,
          author: edition.author,
          translator: edition.translator,
          original_title: book.title,
          book,
          reason: "ok",
        } as unknown as LinkRepairPlan;
        const result = await deps.applyRepair(
          sql,
          plan,
          deps.now(),
          item.status,
        );
        if (result.status !== "linked") {
          skip(simania_id, book_id, "not_linked");
          continue;
        }
        linked++;
      }
      deps.log(JSON.stringify({
        simania_id,
        book_id,
        hebrew_title: edition.title,
        action: options.apply ? "link" : "would_link",
      }));
    } catch (error) {
      failed = true;
      deps.log(JSON.stringify({
        simania_id,
        book_id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  }

  deps.log(JSON.stringify({ proposals: saved.length, linked, skipped }));
  return failed ? 1 : 0;
}

/** Run the CLI and return its exit code. Exported for database-free tests. */
export async function main(
  args: string[] = Deno.args,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const cacheIndex = args.indexOf("--cache-dir");
  const cacheDir = cacheIndex >= 0 ? args[cacheIndex + 1] : undefined;
  if (!cacheDir) return await mainInner(args, overrides);
  const stats: CacheStats = { hits: 0, misses: 0, stored: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = cachedFetch(originalFetch, { dir: cacheDir, stats });
  try {
    return await mainInner(args, overrides);
  } finally {
    globalThis.fetch = originalFetch;
    console.error(JSON.stringify({ cache: stats }));
  }
}

async function mainInner(
  args: string[],
  overrides: Partial<RunDeps>,
): Promise<number> {
  const deps = { ...runDefaults, ...overrides };
  deps.hebrewAuthorBySound = overrides.hebrewAuthorBySound ??
    ((englishName) => hebrewAuthorBySound(englishName, deps.searchBooks));
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
    if (options.from !== null) return await runFromFile(deps, sql, options);
    if (options.hebrew) {
      const loaded = await deps.loadUnlinkedEditions(sql);
      const editions = loaded.slice(
        options.offset,
        options.limit === null ? undefined : options.offset + options.limit,
      );
      const store = deps.authorStore(sql);
      const knownHebrewNames = async (englishAuthors: string[]) => {
        const names: string[] = [];
        for (const author of englishAuthors) {
          const key = nameKey(author);
          if (!key) continue;
          const found = await store.find("en", key);
          for (const row of found?.names ?? []) {
            if (row.lang === "he" && !names.includes(row.name)) {
              names.push(row.name);
            }
          }
        }
        return names;
      };
      const db = serviceCatalogDb(sql);
      const skipped: Record<string, number> = {};
      type Tally = {
        lines: string[];
        skipped: Record<string, number>;
        proposals: number;
      };
      const makeSkip = (tally: Tally) =>
      (
        edition: EditionRow,
        reason: string,
        failures: ProviderFailure[] = [],
        explain: ResolveExplain | null = null,
      ) => {
        tally.skipped[reason] = (tally.skipped[reason] ?? 0) + 1;
        const completedExplain = explain
          ? {
            ...explain,
            stop: explain.stop ?? (reason === "author_mismatch"
              ? "author_mismatch"
              : "guard_rejected"),
          }
          : null;
        tally.lines.push(JSON.stringify({
          simania_id: edition.simania_id,
          skipped: reason,
          ...(reason === "provider_failure" ? { failures } : {}),
          ...(completedExplain ? { explain: completedExplain } : {}),
        }));
      };
      let processed = 0;
      let proposals = 0;
      let rechecked = 0;
      let lines: string[] = [];
      const outputs: { lines: string[]; held: boolean }[] = [];
      let printed = 0;
      const flushOutputs = () => {
        while (printed < outputs.length && !outputs[printed].held) {
          for (const line of outputs[printed].lines) deps.log(line);
          printed++;
        }
      };

      // Handles one edition; returns true when it ended provider_failure.
      const processEdition = async (
        edition: EditionRow,
        tally: Tally,
        _assertLive: () => void,
      ): Promise<boolean> => {
        const skip = makeSkip(tally);
        let failedEdition = false;
        const explain: ResolveExplain | null = options.explain
          ? {
            translator: null,
            original: null,
            english_author: null,
            hardcover_queries: [],
            stop: null,
          }
          : null;
        try {
          if (explain) {
            try {
              const details = await deps.bookDetails(edition.simania_id);
              explain.translator = typeof details?.translator === "string"
                ? details.translator
                : null;
            } catch {
              // Explanation details must not change the resolver's decision.
            }
          }
          const result = explain
            ? await deps.resolveMatch(db, edition, {
              trace: (event) => collectExplain(explain, event),
            })
            : await deps.resolveMatch(db, edition);
          if (result.failed) {
            failedEdition = true;
            skip(edition, "provider_failure", result.failures ?? [], explain);
          } else {
            let found = result.found;
            let via = "hebrew";
            if (!found) {
              skip(edition, "no_candidate", [], explain);
            } else {
              const bookAuthors = authors(found.book);
              const authorAgrees = authorAgreesWithWork(
                edition.author ?? "",
                bookAuthors,
                await knownHebrewNames(bookAuthors),
              );
              if (!authorAgrees) {
                skip(edition, "author_mismatch", [], explain);
              } else if (
                await proposalHasEnglishMismatch(
                  deps,
                  edition,
                  found.book.title,
                )
              ) {
                skip(edition, "nli_english_mismatch", [], explain);
              } else {
                tally.proposals++;
                tally.lines.push(JSON.stringify({
                  hardcover_id: found.book.id,
                  title: found.book.title,
                  proposal: {
                    simania_id: edition.simania_id,
                    book_id: found.book.id,
                    hebrew_title: edition.title,
                    via,
                    status: found.status,
                  },
                }));
              }
            }
          }
        } catch (error) {
          const provider = error instanceof ProviderCallError
            ? error.provider
            : "db";
          failedEdition = true;
          skip(
            edition,
            "provider_failure",
            [failureDetail(provider, error)],
            explain,
          );
        }
        return failedEdition;
      };

      // Deliberately sequential: one provider request at a time.
      // A timed-out edition's late results are discarded with its tally.
      const runEdition = async (edition: EditionRow): Promise<boolean> => {
        // The attempt keeps its own tally; on timeout it is abandoned (late
        // writes land there) and a separate result is built.
        const attempt: Tally = { lines: [], skipped: {}, proposals: 0 };
        const outcome = await withDeadline(
          deps,
          options.workTimeout,
          (assertLive) => processEdition(edition, attempt, assertLive),
        );
        let tally = attempt;
        if (typeof outcome === "object") {
          tally = { lines: [], skipped: {}, proposals: 0 };
          makeSkip(tally)(edition, "provider_failure", [outcome.deadline]);
        }
        lines = tally.lines;
        for (const [reason, n] of Object.entries(tally.skipped)) {
          skipped[reason] = (skipped[reason] ?? 0) + n;
        }
        proposals += tally.proposals;
        return typeof outcome === "object" ? true : outcome;
      };
      const failedEditions: number[] = [];
      for (const edition of editions) {
        processed++;
        const failedEdition = await runEdition(edition);
        outputs.push({ lines, held: failedEdition });
        if (failedEdition) failedEditions.push(outputs.length - 1);
        flushOutputs();

        if (processed % BUDGET_CHECK_EVERY === 0) {
          const remaining = await deps.hardcoverDailyRemaining();
          if (
            remaining !== null && remaining < options.minHardcover &&
            !options.forceHardcover
          ) {
            for (const output of outputs) output.held = false;
            flushOutputs();
            deps.log(JSON.stringify({
              stopped: "hardcover_budget",
              remaining,
              min: options.minHardcover,
              works: processed,
            }));
            return 4;
          }
        }
      }

      // One more attempt for each provider failure, one at a time.
      for (const index of failedEditions) {
        rechecked++;
        skipped.provider_failure--;
        if (skipped.provider_failure === 0) delete skipped.provider_failure;
        await runEdition(editions[index]);
        outputs[index] = { lines, held: false };
      }
      for (const output of outputs) output.held = false;
      flushOutputs();

      deps.log(JSON.stringify({
        works: processed,
        proposals,
        linked: 0,
        skipped,
        ...(rechecked > 0 ? { rechecked } : {}),
      }));
      return 0;
    }
    const works = await deps.loadWorks(sql, options);
    const linkedSimaniaIds = await deps.loadLinkedSimaniaIds(sql);
    const store = deps.authorStore(sql);
    const soundStore: AuthorStore = options.apply ? store : {
      ...store,
      create: () => Promise.resolve(crypto.randomUUID()),
      addNames: () => Promise.resolve(),
      merge: () => Promise.resolve(),
      markWikidataChecked: () => Promise.resolve(),
      markSoundChecked: () => Promise.resolve(),
    };

    const knownHebrewNames = async (englishAuthors: string[]) => {
      const names: string[] = [];
      for (const author of englishAuthors) {
        const key = nameKey(author);
        if (!key) continue;
        const found = await store.find("en", key);
        for (const row of found?.names ?? []) {
          if (row.lang === "he" && !names.includes(row.name)) {
            names.push(row.name);
          }
        }
      }
      return names;
    };

    const firstAuthor = (work: RematchWork) =>
      (work.original_authors ?? [])[0]?.trim() ?? "";
    const THIRTY_DAYS = 30 * 86_400_000;
    const unknown: string[] = [];
    const known = new Map<string, Awaited<ReturnType<AuthorStore["find"]>>>();
    for (const name of new Set(works.map(firstAuthor).filter(Boolean))) {
      const key = nameKey(name);
      if (!key) continue;
      const found = await store.find("en", key);
      known.set(name, found);
      const checked = found?.wikidata_checked_at
        ? new Date(found.wikidata_checked_at).getTime()
        : null;
      const stale = checked !== null &&
        deps.now().getTime() - checked > THIRTY_DAYS;
      const hasHebrew = found?.names.some((row) => row.lang === "he") ?? false;
      if (!found || stale || (checked === null && !hasHebrew)) {
        unknown.push(name);
      }
    }
    // Answers of this run; with --apply they are also stored.
    const wikidataNames = new Map<string, string[]>();
    if (unknown.length > 0) {
      let answers = new Map<string, string[]>();
      const attempts = 3;
      for (let attempt = 1;; attempt++) {
        try {
          answers = await deps.wikidataHebrewAuthors(unknown);
          break;
        } catch {
          if (attempt >= attempts) {
            deps.log(JSON.stringify({ error: "wikidata_authors" }));
            return 3;
          }
          await deps.sleep(30000);
        }
      }
      for (const name of unknown) {
        const answer = answers.get(name) ?? [];
        wikidataNames.set(name, answer);
        if (!options.apply) continue;
        const found = known.get(name) ?? null;
        const authorId = found?.author_id ?? await store.create();
        await store.addNames(authorId, [
          ...(found
            ? []
            : [{ lang: "en" as const, name, source: "wikidata" as const }]),
          ...answer.map((he) => ({
            lang: "he" as const,
            name: he,
            source: "wikidata" as const,
          })),
        ]);
        await store.markWikidataChecked(authorId, deps.now());
      }
    }

    // Shared memos hold outcomes, so each work that uses an entry records the
    // failure detail itself (a failed entry is dropped and retried later).
    const originalsCache = new Map<string, Promise<MemoOutcome<string[]>>>();
    const hebrewNamesMemo = new Map<string, Promise<MemoOutcome<string[]>>>();
    const makeDeps = (
      rememberFailure: (provider: FailureProvider, error: unknown) => void,
      assertLive: () => void,
    ): RematchDeps => {
      // After the work's deadline, author-store writes become no-ops (the
      // lookup is shared through a memo, so it must not fail for others).
      const live = () => {
        try {
          assertLive();
          return true;
        } catch {
          return false;
        }
      };
      const guarded: AuthorStore = {
        ...soundStore,
        create: () =>
          live() ? soundStore.create() : Promise.resolve(crypto.randomUUID()),
        addNames: (...a) =>
          live() ? soundStore.addNames(...a) : Promise.resolve(),
        merge: (...a) => live() ? soundStore.merge(...a) : Promise.resolve(),
        markWikidataChecked: (...a) =>
          live() ? soundStore.markWikidataChecked(...a) : Promise.resolve(),
        markSoundChecked: (...a) =>
          live() ? soundStore.markSoundChecked(...a) : Promise.resolve(),
      };
      const searched = new Map<
        string,
        Awaited<ReturnType<RunDeps["searchBooks"]>>
      >();
      const originals = (title: string, name: string): Promise<string[]> =>
        memoized(originalsCache, title, rememberFailure, async (note) => {
          let wikidata: Map<string, string[]>;
          try {
            wikidata = await deps.wikidataOriginals([title]);
          } catch (error) {
            note("wikidata", error);
            throw error;
          }
          const found = new Set<string>(wikidata.get(title) ?? []);
          let nli: Awaited<ReturnType<RunDeps["nliOriginal"]>>;
          try {
            nli = await deps.nliOriginal(title, name);
          } catch (error) {
            note("nli", error);
            throw error;
          }
          if (nli?.title) found.add(nli.title);
          return [...found];
        });
      return {
        hebrewHint: async (work) => {
          try {
            return await deps.hebrewHint({
              id: work.hardcover_id,
              title: work.original_title,
              cached_contributors: (work.original_authors ?? []).map((
                name,
              ) => ({
                author: { name },
              })),
            });
          } catch (error) {
            if (error instanceof ProviderCallError) {
              rememberFailure(error.provider, error.original);
            }
            throw error;
          }
        },
        matchHebrewBook: async (title, author) => {
          try {
            return simaniaIdOf(await deps.matchHebrewBook(title, author)) ??
              null;
          } catch (error) {
            rememberFailure("simania", error);
            throw error;
          }
        },
        hebrewNames: (work) => {
          const name = firstAuthor(work);
          if (!name) return Promise.resolve([]);
          return memoized(
            hebrewNamesMemo,
            name,
            rememberFailure,
            async (note) => {
              let found: Awaited<ReturnType<AuthorStore["find"]>>;
              try {
                found = await store.find("en", nameKey(name));
              } catch (error) {
                note("db", error);
                throw error;
              }
              const stored = (found?.names ?? [])
                .filter((row) => row.lang === "he")
                .sort((x, y) =>
                  Number(x.source === "wikidata") -
                  Number(y.source === "wikidata")
                )
                .map((row) => row.name);
              const knownNames = [
                ...new Set([...stored, ...(wikidataNames.get(name) ?? [])]),
              ];
              if (knownNames.length > 0) return knownNames;
              try {
                return await soundNames(
                  guarded,
                  name,
                  (englishName) => deps.hebrewAuthorBySound(englishName),
                  deps.now,
                );
              } catch (error) {
                note("sound", error);
                throw error;
              }
            },
          );
        },
        searchBooks: async (query, limit, offset) => {
          // The candidate search and the missed-translation check list the
          // same author; ask the provider once per work.
          const key = JSON.stringify([query, limit, offset]);
          const hit = searched.get(key);
          if (hit) return hit;
          try {
            const found = await deps.searchBooks(query, limit, offset);
            searched.set(key, found);
            return found;
          } catch (error) {
            rememberFailure("simania", error);
            throw error;
          }
        },
        originals,
        linkedSimaniaIds,
      };
    };
    const db = serviceCatalogDb(sql);

    const skipped: Record<string, number> = {};
    let processed = 0;
    let proposals = 0;
    let linked = 0;
    let failed = false;

    // Handles one work; every output line goes to `lines`, never to stdout.
    // Returns true when the work ended provider_failure.
    // Counters are local and merged by runWork, so a work that hit its
    // deadline cannot change shared state when its promises settle later.
    const processWork = async (
      work: RematchWork,
      lines: string[],
      assertLive: () => void,
    ) => {
      const skippedLocal: Record<string, number> = {};
      const skip = (reason: string) => {
        skippedLocal[reason] = (skippedLocal[reason] ?? 0) + 1;
      };
      let proposals = 0;
      let linked = 0;
      let failed = false;
      let providerFailed = false;
      const base = {
        hardcover_id: work.hardcover_id,
        title: work.original_title,
      };
      const failures: ProviderFailure[] = [];
      const rememberFailure = (provider: FailureProvider, error: unknown) => {
        failures.push(failureDetail(provider, error));
      };
      const rematchDeps = makeDeps(rememberFailure, assertLive);
      {
        const { candidates, authorBooks, failed: searchFailed } =
          await findCandidates(
            work,
            rematchDeps,
          );
        let anyFailed = searchFailed;
        let rejected = false;
        let authorMismatch = false;
        let linkedElsewhere = false;
        let duplicateOf: number | null = null;
        let proposal: Proposal | null = null;

        const sameAuthors = async (a: string[], b: string[]) => {
          const keys = new Set(b.map((name) => nameKey(name)).filter(Boolean));
          return a.length > 0 && b.length > 0 &&
            a.some((name) => keys.has(nameKey(name)));
        };

        const candidateEdition = async (
          simaniaId: number,
        ): Promise<{ edition: EditionRow; existed: boolean } | null> => {
          let edition: EditionRow | null;
          try {
            edition = await deps.loadEdition(sql, simaniaId);
          } catch (error) {
            anyFailed = true;
            failures.push(failureDetail("db", error));
            return null;
          }
          if (edition?.work_id) {
            linkedElsewhere = true;
            if (duplicateOf === null) {
              try {
                const other = await deps.loadLinkedWork(sql, simaniaId);
                if (
                  other && other.hardcover_id !== work.hardcover_id &&
                  normalize(other.original_title) ===
                    normalize(work.original_title) &&
                  (await sameAuthors(
                    work.original_authors ?? [],
                    other.original_authors ?? [],
                  ))
                ) {
                  duplicateOf = other.hardcover_id;
                }
              } catch {
                // The duplicate hint is optional; it never changes the outcome.
              }
            }
            return null;
          }
          const existed = edition !== null;
          if (!edition) {
            try {
              edition = toEditionRow(await deps.fetchEditionDetails(simaniaId));
            } catch (error) {
              anyFailed = true;
              failures.push(failureDetail("simania", error));
              return null;
            }
          }
          return { edition, existed };
        };

        const agreementNames = async (
          englishAuthors: string[],
        ): Promise<string[] | null> => {
          try {
            return await knownHebrewNames(englishAuthors);
          } catch (error) {
            anyFailed = true;
            failures.push(failureDetail("db", error));
            return null;
          }
        };

        for (const candidate of candidates) {
          const loaded = await candidateEdition(candidate.simania_id);
          if (!loaded) continue;
          const { edition, existed } = loaded;
          const knownNames = await agreementNames(work.original_authors ?? []);
          if (!knownNames) continue;
          const authorAgrees = authorAgreesWithWork(
            edition.author ?? "",
            work.original_authors ?? [],
            knownNames,
          );
          try {
            const result = await confirmCandidate(work, edition, authorAgrees, {
              resolveMatch: async (e) => {
                const resolved = await deps.resolveMatch(db, e);
                failures.push(...(resolved.failures ?? []));
                return resolved;
              },
            });
            if (!authorAgrees) authorMismatch = true;
            else if (result.failed) anyFailed = true;
            else if (!result.accepted || !result.book || !result.status) {
              rejected = true;
            } else {
              proposal = {
                work,
                edition,
                existed,
                via: candidate.via,
                status: result.status,
                book: result.book,
              };
              break;
            }
          } catch (error) {
            anyFailed = true;
            failures.push(failureDetail("db", error));
          }
        }

        const reasonBeforeDictionary = anyFailed
          ? "provider_failure"
          : authorMismatch
          ? "author_mismatch"
          : rejected
          ? "rejected"
          : linkedElsewhere
          ? "linked_elsewhere"
          : "no_candidate";
        if (
          !proposal && !anyFailed && authorBooks.length > 0 &&
          (reasonBeforeDictionary === "no_candidate" ||
            reasonBeforeDictionary === "rejected" ||
            reasonBeforeDictionary === "author_mismatch")
        ) {
          let picked: Awaited<ReturnType<typeof pickByDictionary>> = null;
          try {
            picked = await pickByDictionary(
              work.original_title,
              authorBooks,
              deps.wiktionaryGlosses,
            );
          } catch (error) {
            anyFailed = true;
            failures.push(failureDetail("wiktionary", error));
          }
          if (picked) {
            const loaded = await candidateEdition(picked.simania_id);
            if (loaded) {
              const { edition, existed } = loaded;
              const knownNames = await agreementNames(
                work.original_authors ?? [],
              );
              if (knownNames === null) {
                // The failed database lookup is already recorded.
              } else if (
                !authorAgreesWithWork(
                  edition.author ?? "",
                  work.original_authors ?? [],
                  knownNames,
                )
              ) {
                authorMismatch = true;
              } else {
                proposal = {
                  work,
                  edition,
                  existed,
                  via: "dictionary",
                  status: "dictionary",
                  book: {
                    id: work.hardcover_id,
                    title: work.original_title,
                    cached_contributors: (work.original_authors ?? []).map((
                      name,
                    ) => ({
                      author: { name },
                    })),
                  },
                };
              }
            }
          }
        }

        if (
          !proposal && !anyFailed && !linkedElsewhere
        ) {
          const decision = await decideMissedTranslation(
            {
              original_title: work.original_title,
              original_authors: work.original_authors ?? [],
            },
            linkedSimaniaIds,
            {
              hebrewAuthor: async (name) =>
                (await rematchDeps.hebrewNames({
                  ...work,
                  original_authors: [name],
                }))[0] ?? null,
              searchBooks: rematchDeps.searchBooks,
              nliOriginal: async (title, name) => {
                try {
                  return await deps.nliOriginal(title, name);
                } catch (error) {
                  rememberFailure("nli", error);
                  throw error;
                }
              },
              wikidataOriginal: async (title) => {
                try {
                  const found = (await deps.wikidataOriginals([title])).get(
                    title,
                  );
                  return found?.[0] ? { title: found[0] } : null;
                } catch (error) {
                  rememberFailure("wikidata", error);
                  throw error;
                }
              },
            },
            { withBook: true },
          );
          if (decision.failed) anyFailed = true;
          if (decision.book) {
            const loaded = await candidateEdition(decision.book.simania_id);
            const knownNames = loaded
              ? await agreementNames(work.original_authors ?? [])
              : null;
            if (loaded && knownNames) {
              if (
                !authorAgreesWithWork(
                  loaded.edition.author ?? "",
                  work.original_authors ?? [],
                  knownNames,
                )
              ) {
                authorMismatch = true;
              } else {
                proposal = {
                  work,
                  edition: loaded.edition,
                  existed: loaded.existed,
                  via: "author_books",
                  status: "nli",
                  book: {
                    id: work.hardcover_id,
                    title: work.original_title,
                    cached_contributors: (work.original_authors ?? []).map((
                      name,
                    ) => ({ author: { name } })),
                  },
                };
              }
            }
          }
        }

        if (
          proposal &&
          await proposalHasEnglishMismatch(
            deps,
            proposal.edition,
            proposal.work.original_title,
          )
        ) {
          skip("nli_english_mismatch");
          lines.push(JSON.stringify({
            ...base,
            skipped: "nli_english_mismatch",
          }));
          proposal = null;
        } else if (!proposal) {
          const reason = authorMismatch
            ? "author_mismatch"
            : anyFailed
            ? "provider_failure"
            : rejected
            ? "rejected"
            : linkedElsewhere
            ? "linked_elsewhere"
            : "no_candidate";
          skip(reason);
          if (reason === "provider_failure") providerFailed = true;
          lines.push(JSON.stringify({
            ...base,
            skipped: reason,
            ...(reason === "provider_failure" ? { failures } : {}),
            ...(reason === "linked_elsewhere" && duplicateOf !== null
              ? { duplicate_of: duplicateOf }
              : {}),
          }));
        }
        if (proposal) {
          proposals++;
          lines.push(JSON.stringify({
            ...base,
            proposal: {
              simania_id: proposal.edition.simania_id,
              book_id: proposal.book.id,
              hebrew_title: proposal.edition.title,
              via: proposal.via,
              status: proposal.status,
            },
          }));
          if (options.apply) {
            const id = proposal.edition.simania_id;
            try {
              let book = proposal.book;
              let detailsOk = true;
              if (
                proposal.via === "dictionary" ||
                proposal.via === "author_books" ||
                deps.isSearchDocumentBook(book)
              ) {
                let detailed: HardcoverBook | undefined;
                try {
                  detailed = (await deps.hardcoverBooks([book.id]))[0];
                } catch {
                  detailed = undefined;
                }
                if (detailed) book = detailed;
                else detailsOk = false;
              }
              if (!detailsOk) {
                skip("details_failure");
                lines.push(
                  JSON.stringify({
                    simania_id: id,
                    skipped: "details_failure",
                  }),
                );
              } else {
                assertLive();
                if (!proposal.existed) {
                  await deps.insertEdition(sql, proposal.edition);
                }
                const plan = {
                  kind: "link",
                  simania_id: id,
                  title: proposal.edition.title,
                  author: proposal.edition.author,
                  translator: proposal.edition.translator,
                  original_title: book.title,
                  book,
                  reason: "ok",
                } as unknown as LinkRepairPlan;
                assertLive();
                const result = await deps.applyRepair(
                  sql,
                  plan,
                  deps.now(),
                  proposal.status,
                );
                if (result.status === "linked") linked++;
                else skip("not_linked");
              }
            } catch (error) {
              failed = true;
              lines.push(JSON.stringify({
                simania_id: id,
                status: "failed",
                error: error instanceof Error ? error.message : "Unknown error",
              }));
            }
          }
        }
      }
      return {
        providerFailed,
        skipped: skippedLocal,
        proposals,
        linked,
        failed,
      };
    };

    // Runs one work under the deadline; returns true on provider_failure.
    const runWork = async (
      work: RematchWork,
      lines: string[],
    ): Promise<boolean> => {
      const mine: string[] = [];
      const outcome = await withDeadline(
        deps,
        options.workTimeout,
        (assertLive) => processWork(work, mine, assertLive),
      );
      if ("deadline" in outcome) {
        skipped.provider_failure = (skipped.provider_failure ?? 0) + 1;
        lines.push(JSON.stringify({
          hardcover_id: work.hardcover_id,
          title: work.original_title,
          skipped: "provider_failure",
          failures: [outcome.deadline],
        }));
        return true;
      }
      lines.push(...mine);
      for (const [reason, n] of Object.entries(outcome.skipped)) {
        skipped[reason] = (skipped[reason] ?? 0) + n;
      }
      proposals += outcome.proposals;
      linked += outcome.linked;
      if (outcome.failed) failed = true;
      return outcome.providerFailed;
    };

    // Up to `concurrency` works at once; lines print strictly in work order.
    const started = Date.now();
    const buffers: (string[] | null)[] = works.map(() => null);
    let nextPrint = 0;
    let nextWork = 0;
    let done = 0;
    let stop = false;
    let stopInfo: { remaining: number } | null = null;
    const held = new Set<number>();
    const flush = () => {
      while (
        nextPrint < works.length && buffers[nextPrint] &&
        !held.has(nextPrint)
      ) {
        for (const line of buffers[nextPrint]!) deps.log(line);
        buffers[nextPrint++] = null;
        // A started-but-unfinished gap stops the loop; later ones wait.
      }
    };
    const worker = async () => {
      while (!stop && nextWork < works.length) {
        const index = nextWork++;
        processed++;
        const lines: string[] = [];
        try {
          if (await runWork(works[index], lines)) held.add(index);
        } finally {
          buffers[index] = lines;
          flush();
        }
        done++;
        if (done % PROGRESS_EVERY === 0) {
          console.error(JSON.stringify({
            progress: {
              done,
              total: works.length,
              elapsed_s: Math.round((Date.now() - started) / 1000),
            },
          }));
        }
        if ((index + 1) % BUDGET_CHECK_EVERY === 0) {
          const remaining = await deps.hardcoverDailyRemaining();
          if (
            remaining !== null && remaining < options.minHardcover &&
            !options.forceHardcover && !stop
          ) {
            stop = true;
            stopInfo = { remaining };
          }
        }
      }
    };
    const results = await Promise.allSettled(
      Array.from(
        { length: Math.min(options.concurrency, works.length) },
        worker,
      ),
    );
    const rejected = results.find((r) => r.status === "rejected");
    let rechecked = 0;
    if (stopInfo === null && !rejected) {
      // One more attempt for each provider failure, one at a time.
      for (const index of [...held].sort((a, b) => a - b)) {
        rechecked++;
        skipped.provider_failure--;
        if (skipped.provider_failure === 0) delete skipped.provider_failure;
        const lines: string[] = [];
        await runWork(works[index], lines);
        buffers[index] = lines;
      }
    }
    held.clear();
    flush();
    if (rejected) throw (rejected as PromiseRejectedResult).reason;
    if (stopInfo !== null) {
      deps.log(JSON.stringify({
        stopped: "hardcover_budget",
        remaining: (stopInfo as { remaining: number }).remaining,
        min: options.minHardcover,
        works: processed,
      }));
      return 4;
    }

    deps.log(JSON.stringify({
      works: processed,
      proposals,
      linked,
      skipped,
      ...(rechecked > 0 ? { rechecked } : {}),
    }));
    return failed ? 1 : 0;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  // hardcover.ts and the Wikimedia helpers call global fetch; throttle it here
  // only, so edge functions keep their speed.
  globalThis.fetch = throttledProviderFetch(globalThis.fetch);
  try {
    const policy = { timeoutMs: 25000, pauseMs: 1000 };
    setProviderRetry(policy);
    setSimaniaRetry(policy);
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Rematch cached failed.",
    );
    Deno.exit(1);
  }
}
