import type { Sql } from "npm:postgres@3.4.5";
import {
  type CatalogDb,
  resolveMatch,
} from "../supabase/functions/_shared/catalog.ts";
import {
  nliOriginal,
  wikidataHebrewAuthors,
  wikidataOriginals,
} from "../supabase/functions/_shared/bridges.ts";
import {
  type HardcoverBook,
  hardcoverBooks,
  isSearchDocumentBook,
} from "../supabase/functions/_shared/hardcover.ts";
import {
  fetchEditionDetails,
  searchBooks,
} from "../supabase/functions/_shared/simania.ts";
import { normalize } from "../supabase/functions/_shared/utils.ts";
import { defaultHebrewHint } from "../supabase/functions/recommendations/index.ts";
import type { EditionRow } from "../supabase/functions/_shared/types.ts";
import { matchHebrewBook, simaniaIdOf } from "../public/js/simania.js";
import {
  checkHardcoverBudget,
  hardcoverDailyRemaining,
} from "./lib/hardcover-budget.ts";
import { loadOperatorEnv, openProdDb } from "./lib/prod-db.ts";
import {
  authorNamesFromLinks,
  confirmCandidate,
  findCandidates,
  type RematchDeps,
  type RematchWork,
} from "./lib/rematch.ts";
import { serviceCatalogDb } from "./recheck-links.ts";
import {
  applyRepair,
  type LinkRepairPlan,
  type RepairResult,
} from "./repair-links.ts";

const USAGE =
  "Usage: rematch:cached [--apply] [--hardcover-id <id>] [--offset <n>] [--limit <n>] [--min-hardcover <n>] [--force-hardcover]";

const BUDGET_CHECK_EVERY = 50;

export type RematchStatus = "wikidata" | "nli" | "fuzzy";

export interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  loadWorks: (
    sql: Sql,
    options: { hardcoverId: number | null; offset: number; limit: number | null },
  ) => Promise<RematchWork[]>;
  loadLinkPairs: (sql: Sql) => Promise<{ he: string; en: string }[]>;
  loadLinkedSimaniaIds: (sql: Sql) => Promise<Set<number>>;
  loadEdition: (sql: Sql, simaniaId: number) => Promise<EditionRow | null>;
  insertEdition: (sql: Sql, edition: EditionRow) => Promise<void>;
  wikidataHebrewAuthors: (names: string[]) => Promise<Map<string, string[]>>;
  wikidataOriginals: (titles: string[]) => Promise<Map<string, string[]>>;
  nliOriginal: (
    title: string,
    author: string,
  ) => Promise<{ title: string } | null>;
  hebrewHint: (
    book: HardcoverBook,
  ) => Promise<{ title: string; author?: string | null } | null>;
  matchHebrewBook: (title: string, author: string) => Promise<unknown>;
  searchBooks: RematchDeps["searchBooks"];
  fetchEditionDetails: (id: number) => Promise<Record<string, unknown>>;
  resolveMatch: (
    db: CatalogDb,
    edition: EditionRow,
  ) => ReturnType<typeof resolveMatch>;
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
  loadLinkPairs: async (sql) =>
    await sql<{ he: string; en: string }[]>`
      select e.author as he, w.original_authors[1] as en
      from public.editions as e
      inner join public.works as w on w.id = e.work_id
      where e.simania_id > 0 and e.author is not null
        and w.original_authors[1] is not null
    `,
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
  hebrewHint: (book) => defaultHebrewHint(book),
  matchHebrewBook: (title, author) => matchHebrewBook(title, author),
  searchBooks,
  fetchEditionDetails,
  resolveMatch: (db, edition) => resolveMatch(db, edition),
  applyRepair: applyRepair as unknown as RunDeps["applyRepair"],
  hardcoverBooks,
  isSearchDocumentBook,
  hardcoverDailyRemaining: () => hardcoverDailyRemaining(),
  checkHardcoverBudget,
  now: () => new Date(),
  log: console.log,
  error: console.error,
};

interface CliOptions {
  apply: boolean;
  hardcoverId: number | null;
  offset: number;
  limit: number | null;
  minHardcover: number;
  forceHardcover: boolean;
}

function parseArgs(args: string[]): CliOptions | null {
  const options: CliOptions = {
    apply: false,
    hardcoverId: null,
    offset: 0,
    limit: null,
    minHardcover: 1500,
    forceHardcover: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--force-hardcover") options.forceHardcover = true;
    else if (
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
    } else return null;
  }
  return options;
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
  via: "forward" | "reverse";
  status: RematchStatus;
  book: HardcoverBook;
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

  const budgetOkay = await deps.checkHardcoverBudget({
    min: options.minHardcover,
    force: options.forceHardcover,
    log: deps.log,
  });
  if (!budgetOkay) return 4;

  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: !options.apply });
  try {
    const works = await deps.loadWorks(sql, options);
    const linkNames = authorNamesFromLinks(await deps.loadLinkPairs(sql));
    const linkedSimaniaIds = await deps.loadLinkedSimaniaIds(sql);

    const firstAuthor = (work: RematchWork) =>
      (work.original_authors ?? [])[0]?.trim() ?? "";
    const missing = [
      ...new Set(
        works.map(firstAuthor).filter((name) =>
          name && !linkNames.has(normalize(name))
        ),
      ),
    ];
    let wikidataNames = new Map<string, string[]>();
    if (missing.length > 0) {
      try {
        wikidataNames = await deps.wikidataHebrewAuthors(missing);
      } catch {
        deps.log(JSON.stringify({ error: "wikidata_authors" }));
        return 3;
      }
    }

    const originalsCache = new Map<string, Promise<string[]>>();
    const originals = (title: string, name: string): Promise<string[]> => {
      let cached = originalsCache.get(title);
      if (!cached) {
        cached = (async () => {
          const found = new Set<string>(
            (await deps.wikidataOriginals([title])).get(title) ?? [],
          );
          const nli = await deps.nliOriginal(title, name);
          if (nli?.title) found.add(nli.title);
          return [...found];
        })();
        originalsCache.set(title, cached);
        cached.catch(() => originalsCache.delete(title));
      }
      return cached;
    };

    const rematchDeps: RematchDeps = {
      hebrewHint: (work) =>
        deps.hebrewHint({
          id: work.hardcover_id,
          title: work.original_title,
          cached_contributors: (work.original_authors ?? []).map((name) => ({
            author: { name },
          })),
        }),
      matchHebrewBook: async (title, author) =>
        simaniaIdOf(await deps.matchHebrewBook(title, author)) ?? null,
      hebrewNames: (work) => {
        const name = firstAuthor(work);
        if (!name) return Promise.resolve([]);
        return Promise.resolve(
          linkNames.get(normalize(name)) ?? wikidataNames.get(name) ?? [],
        );
      },
      searchBooks: deps.searchBooks,
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
      const base = { hardcover_id: work.hardcover_id, title: work.original_title };
      const { candidates, failed: searchFailed } = await findCandidates(
        work,
        rematchDeps,
      );
      let anyFailed = searchFailed;
      let rejected = false;
      let linkedElsewhere = false;
      let proposal: Proposal | null = null;

      for (const candidate of candidates) {
        let edition: EditionRow | null;
        let existed = true;
        try {
          edition = await deps.loadEdition(sql, candidate.simania_id);
          if (edition?.work_id) {
            linkedElsewhere = true;
            continue;
          }
          if (!edition) {
            existed = false;
            edition = toEditionRow(
              await deps.fetchEditionDetails(candidate.simania_id),
            );
          }
          const result = await confirmCandidate(work, edition, {
            resolveMatch: (e) => deps.resolveMatch(db, e),
          });
          if (result.failed) anyFailed = true;
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
        } catch {
          anyFailed = true;
        }
      }

      if (!proposal) {
        const reason = anyFailed
          ? "provider_failure"
          : rejected
          ? "rejected"
          : linkedElsewhere
          ? "linked_elsewhere"
          : "no_candidate";
        skip(reason);
        deps.log(JSON.stringify({ ...base, skipped: reason }));
      } else {
        proposals++;
        deps.log(JSON.stringify({
          ...base,
          proposal: {
            simania_id: proposal.edition.simania_id,
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
            if (deps.isSearchDocumentBook(book)) {
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
              deps.log(JSON.stringify({ simania_id: id, skipped: "details_failure" }));
            } else {
              if (!proposal.existed) await deps.insertEdition(sql, proposal.edition);
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
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Rematch cached failed.",
    );
    Deno.exit(1);
  }
}
