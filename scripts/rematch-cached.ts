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
import {
  dictionaryVerdict,
  pickByDictionary,
  wordForms,
} from "./lib/dictionary.ts";
import {
  throttledHardcoverFetch,
  throttledWikimediaFetch,
} from "./lib/provider-throttle.ts";
import { nliEnglishMismatch } from "./lib/nli-english-mismatch.ts";
import { decideMissedTranslation } from "./measure-links.ts";
import { serviceCatalogDb } from "./recheck-links.ts";
import {
  applyRepair,
  type LinkRepairPlan,
  type RepairResult,
} from "./repair-links.ts";

const USAGE =
  "Usage: rematch:cached [--apply] [--hebrew] [--explain] [--hardcover-id <id>] [--offset <n>] [--limit <n>] [--from <path>] [--min-hardcover <n>] [--force-hardcover]";

const BUDGET_CHECK_EVERY = 50;

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

export type RematchStatus = "wikidata" | "nli" | "fuzzy" | "dictionary";

export interface RunDeps {
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
  };
  let usedOthers = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--hebrew") options.hebrew = true;
    else if (arg === "--explain") options.explain = true;
    else if (arg === "--force-hardcover") options.forceHardcover = true;
    else if (arg === "--from") {
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
  if (options.from !== null && usedOthers) return null;
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

function dictionaryGlossHead(value: string): string {
  const words = value
    .replace(/\([^)]*\)/g, " ")
    .split(/(?:;|,|\bor\b)/i, 1)[0]
    .match(/[a-z]+(?:['-][a-z]+)*/gi) ?? [];
  while (/^(?:a|an|the|to)$/i.test(words[0] ?? "")) words.shift();
  return words.slice(0, 2).join(" ");
}

async function dictionaryEnglishTitle(
  title: string,
  glosses: RunDeps["wiktionaryGlosses"],
): Promise<string | null> {
  const translated: string[] = [];
  for (const word of title.match(/[\u0590-\u05ff']+/gu) ?? []) {
    let head = "";
    for (const form of wordForms(word)) {
      const answers = await identifyProvider(
        "wiktionary",
        () => glosses(form),
      );
      head = answers.map(dictionaryGlossHead).find(Boolean) ?? "";
      if (head) break;
    }
    if (head) translated.push(head);
  }
  return translated.join(" ").trim() || null;
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
  const deps = { ...runDefaults, ...overrides };
  // Resolver fakes must also fake both dictionary providers; never mix a fake
  // resolver decision with live Wiktionary or Hardcover calls in unit tests.
  const dictionaryFallbackAvailable = overrides.resolveMatch === undefined ||
    (overrides.wiktionaryGlosses !== undefined &&
      overrides.findHardcoverBook !== undefined);
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
      const skip = (
        edition: EditionRow,
        reason: string,
        failures: ProviderFailure[] = [],
        explain: ResolveExplain | null = null,
      ) => {
        skipped[reason] = (skipped[reason] ?? 0) + 1;
        const completedExplain = explain
          ? {
            ...explain,
            stop: explain.stop ?? (reason === "author_mismatch"
              ? "author_mismatch"
              : "guard_rejected"),
          }
          : null;
        deps.log(JSON.stringify({
          simania_id: edition.simania_id,
          skipped: reason,
          ...(reason === "provider_failure" ? { failures } : {}),
          ...(completedExplain ? { explain: completedExplain } : {}),
        }));
      };
      let processed = 0;
      let proposals = 0;

      // Deliberately sequential: one provider request at a time.
      for (const edition of editions) {
        processed++;
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
            skip(edition, "provider_failure", result.failures ?? [], explain);
          } else {
            let found = result.found;
            let via = "hebrew";
            if (!found && dictionaryFallbackAvailable) {
              const dictionaryTitle = await dictionaryEnglishTitle(
                edition.title,
                deps.wiktionaryGlosses,
              );
              if (dictionaryTitle) {
                if (explain) {
                  explain.original = {
                    title: dictionaryTitle,
                    source: "dictionary",
                  };
                  explain.stop = null;
                }
                const queryStart = explain?.hardcover_queries.length ?? 0;
                const knownAuthor = await store.find(
                  "he",
                  nameKey(edition.author ?? ""),
                );
                const englishAuthor = knownAuthor?.names.find((name) =>
                  name.lang === "en"
                )?.name ?? "";
                const book = await identifyProvider(
                  "hardcover",
                  () =>
                    deps.findHardcoverBook(
                      dictionaryTitle,
                      englishAuthor,
                      {
                        requireAuthor: true,
                        retryWithAuthor: true,
                        soundAuthor: edition.author ?? "",
                        ...(explain
                          ? {
                            trace: (query) =>
                              collectExplain(explain, {
                                type: "hardcover_query",
                                ...query,
                              }),
                          }
                          : {}),
                      },
                    ),
                );
                if (!book && explain) {
                  const queries = explain.hardcover_queries.slice(queryStart);
                  const results = queries.reduce(
                    (sum, query) => sum + query.results,
                    0,
                  );
                  const bestScore = queries.reduce<number | null>(
                    (best, query) =>
                      query.best_score !== null &&
                        (best === null || query.best_score > best)
                        ? query.best_score
                        : best,
                    null,
                  );
                  explain.stop = results === 0
                    ? "no_hardcover_result"
                    : (bestScore ?? 0) < 0.5
                    ? "title_below_threshold"
                    : "author_mismatch";
                }
                if (book) {
                  const verdict = await identifyProvider(
                    "wiktionary",
                    () =>
                      dictionaryVerdict(
                        edition.title,
                        book.title,
                        deps.wiktionaryGlosses,
                      ),
                  );
                  if (
                    verdict.english >= 0.67 && verdict.hebrew >= 0.67 &&
                    verdict.contradicted === 0
                  ) {
                    found = { book, status: "fuzzy" };
                    via = "hebrew_dictionary";
                  } else if (explain) {
                    explain.stop = "guard_rejected";
                  }
                }
              } else if (explain) {
                explain.stop = "no_original";
              }
            }
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
                proposals++;
                deps.log(JSON.stringify({
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
          skip(
            edition,
            "provider_failure",
            [failureDetail(provider, error)],
            explain,
          );
        }

        if (processed % BUDGET_CHECK_EVERY === 0) {
          const remaining = await deps.hardcoverDailyRemaining();
          if (
            remaining !== null && remaining < options.minHardcover &&
            !options.forceHardcover
          ) {
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

      deps.log(JSON.stringify({
        works: processed,
        proposals,
        linked: 0,
        skipped,
      }));
      return 0;
    }
    const works = await deps.loadWorks(sql, options);
    const linkedSimaniaIds = await deps.loadLinkedSimaniaIds(sql);
    const store = deps.authorStore(sql);
    let currentFailures: ProviderFailure[] | null = null;
    const rememberFailure = (provider: FailureProvider, error: unknown) => {
      currentFailures?.push(failureDetail(provider, error));
    };
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

    const originalsCache = new Map<string, Promise<string[]>>();
    const originals = (title: string, name: string): Promise<string[]> => {
      let cached = originalsCache.get(title);
      if (!cached) {
        cached = (async () => {
          let wikidata: Map<string, string[]>;
          try {
            wikidata = await deps.wikidataOriginals([title]);
          } catch (error) {
            rememberFailure("wikidata", error);
            throw error;
          }
          const found = new Set<string>(wikidata.get(title) ?? []);
          let nli: Awaited<ReturnType<RunDeps["nliOriginal"]>>;
          try {
            nli = await deps.nliOriginal(title, name);
          } catch (error) {
            rememberFailure("nli", error);
            throw error;
          }
          if (nli?.title) found.add(nli.title);
          return [...found];
        })();
        originalsCache.set(title, cached);
        cached.catch(() => originalsCache.delete(title));
      }
      return cached;
    };

    const hebrewNamesMemo = new Map<string, Promise<string[]>>();
    const rematchDeps: RematchDeps = {
      hebrewHint: async (work) => {
        try {
          return await deps.hebrewHint({
            id: work.hardcover_id,
            title: work.original_title,
            cached_contributors: (work.original_authors ?? []).map((name) => ({
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
          return simaniaIdOf(await deps.matchHebrewBook(title, author)) ?? null;
        } catch (error) {
          rememberFailure("simania", error);
          throw error;
        }
      },
      hebrewNames: (work) => {
        const name = firstAuthor(work);
        if (!name) return Promise.resolve([]);
        const memo = hebrewNamesMemo.get(name);
        if (memo) return memo;
        const result = (async () => {
          let found: Awaited<ReturnType<AuthorStore["find"]>>;
          try {
            found = await store.find("en", nameKey(name));
          } catch (error) {
            rememberFailure("db", error);
            throw error;
          }
          const stored = (found?.names ?? [])
            .filter((row) => row.lang === "he")
            .sort((x, y) =>
              Number(x.source === "wikidata") - Number(y.source === "wikidata")
            )
            .map((row) => row.name);
          const knownNames = [
            ...new Set([...stored, ...(wikidataNames.get(name) ?? [])]),
          ];
          if (knownNames.length > 0) return knownNames;
          try {
            return await soundNames(
              soundStore,
              name,
              (englishName) => deps.hebrewAuthorBySound(englishName),
              deps.now,
            );
          } catch (error) {
            rememberFailure("sound", error);
            throw error;
          }
        })();
        hebrewNamesMemo.set(name, result);
        result.catch(() => hebrewNamesMemo.delete(name));
        return result;
      },
      searchBooks: async (query, limit, offset) => {
        try {
          return await deps.searchBooks(query, limit, offset);
        } catch (error) {
          rememberFailure("simania", error);
          throw error;
        }
      },
      originals,
      linkedSimaniaIds,
    };
    const db = serviceCatalogDb(sql);

    const skipped: Record<string, number> = {};
    const skip = (reason: string) => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    };
    let processed = 0;
    let proposals = 0;
    let linked = 0;
    let failed = false;

    // Deliberately sequential: one provider request at a time.
    for (const work of works) {
      processed++;
      const base = {
        hardcover_id: work.hardcover_id,
        title: work.original_title,
      };
      const failures: ProviderFailure[] = [];
      currentFailures = failures;
      const { candidates, authorBooks, failed: searchFailed } =
        await findCandidates(
          work,
          rematchDeps,
        );
      currentFailures = null;
      let anyFailed = searchFailed;
      let rejected = false;
      let authorMismatch = false;
      let linkedElsewhere = false;
      let proposal: Proposal | null = null;

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

      if (!proposal && !anyFailed && !linkedElsewhere && authorBooks.length > 0) {
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
        deps.log(JSON.stringify({
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
        deps.log(JSON.stringify({
          ...base,
          skipped: reason,
          ...(reason === "provider_failure" ? { failures } : {}),
        }));
      }
      if (proposal) {
        proposals++;
        deps.log(JSON.stringify({
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
              proposal.via === "dictionary" || proposal.via === "author_books" ||
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
              deps.log(
                JSON.stringify({ simania_id: id, skipped: "details_failure" }),
              );
            } else {
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
            deps.log(JSON.stringify({
              simania_id: id,
              status: "failed",
              error: error instanceof Error ? error.message : "Unknown error",
            }));
          }
        }
      }

      if (processed % BUDGET_CHECK_EVERY === 0) {
        const remaining = await deps.hardcoverDailyRemaining();
        if (
          remaining !== null && remaining < options.minHardcover &&
          !options.forceHardcover
        ) {
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

    deps.log(JSON.stringify({
      works: processed,
      proposals,
      linked,
      skipped,
    }));
    return failed ? 1 : 0;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  // hardcover.ts and the Wikimedia helpers call global fetch; throttle it here
  // only, so edge functions keep their speed.
  globalThis.fetch = throttledWikimediaFetch(
    throttledHardcoverFetch(globalThis.fetch),
  );
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Rematch cached failed.",
    );
    Deno.exit(1);
  }
}
