import type { Sql } from "npm:postgres@3.4.5";
import {
  nliOriginal,
  wikidataHebrewAuthorStrict,
  wikidataOriginal,
} from "../supabase/functions/_shared/bridges.ts";
import {
  bookDetails,
  searchBooks,
  type SimaniaBook,
  type SimaniaBookDetails,
} from "../supabase/functions/_shared/simania.ts";
import { similarity } from "../supabase/functions/_shared/utils.ts";
import { openProdDb } from "./lib/prod-db.ts";

export interface InUseWork {
  id: string;
  original_title: string;
  original_authors: string[];
  has_hebrew: boolean;
  simania_id: number | null;
}

export interface MeasureProviders {
  hebrewAuthor: (englishName: string) => Promise<string | null>;
  searchBooks: (
    query: string,
    limit: number,
    offset: number,
  ) => Promise<SimaniaBook[]>;
  nliOriginal: (
    hebrewTitle: string,
    hebrewAuthor: string,
  ) => Promise<{ title: string } | null>;
  wikidataOriginal: (
    hebrewTitle: string,
  ) => Promise<{ title: string } | null>;
}

export interface WorkDecision {
  missed: boolean;
  failed: boolean;
}

export interface WrongLinkProviders {
  bookDetails: (simaniaId: number) => Promise<SimaniaBookDetails | null>;
  nliOriginal: (
    hebrewTitle: string,
    hebrewAuthor: string,
  ) => Promise<{ title: string } | null>;
}

export interface WrongLinkDecision {
  result: "agree" | "differ" | "unknown";
  nliTitle: string | null;
}

export interface UnlinkedHebrewEdition {
  simania_id: number;
  title: string;
  author: string | null;
}

export interface HebrewMeasureProviders {
  nliOriginal: (
    hebrewTitle: string,
    hebrewAuthor: string,
  ) => Promise<{ title: string } | null>;
  wikidataOriginal: (
    hebrewTitle: string,
  ) => Promise<{ title: string } | null>;
  bookDetails: (simaniaId: number) => Promise<SimaniaBookDetails | null>;
}

export type HebrewEditionKind =
  | "translation_with_original"
  | "translated_no_original"
  | "provider_failure"
  | "no_evidence";

const HEBREW = /[\u0590-\u05ff]/;

function simaniaId(book: SimaniaBook): number | null {
  const value = Number(book.id ?? book.bookId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function stripTitle(title: string): string {
  return title
    .replace(/\(.*?\)|:.*$/g, "")
    .replace(/^the\s+/i, "")
    .trim();
}

/** Select an evenly spaced, deterministic sample from works ordered by id. */
export function sampleLinkedWorks<T>(works: readonly T[], n: number): T[] {
  if (n <= 0 || works.length === 0) return [];
  const step = Math.max(1, Math.floor(works.length / n));
  const sample: T[] = [];
  for (
    let index = 0;
    index < works.length && sample.length < n;
    index += step
  ) {
    sample.push(works[index]);
  }
  return sample;
}

/** Check one linked Hebrew edition against its work through NLI. */
export async function decideWrongLink(
  work: Pick<InUseWork, "original_title" | "simania_id">,
  providers: WrongLinkProviders,
): Promise<WrongLinkDecision> {
  if (!work.simania_id || work.simania_id <= 0) {
    return { result: "unknown", nliTitle: null };
  }
  try {
    const details = await providers.bookDetails(work.simania_id);
    const hebrewTitle = typeof details?.title === "string"
      ? details.title.trim()
      : "";
    const hebrewAuthor = typeof details?.author === "string"
      ? details.author.trim()
      : "";
    if (!hebrewTitle) return { result: "unknown", nliTitle: null };

    const original = await providers.nliOriginal(hebrewTitle, hebrewAuthor);
    const nliTitle = original?.title?.trim() ?? "";
    if (!nliTitle) return { result: "unknown", nliTitle: null };
    const score = Math.max(
      similarity(work.original_title, nliTitle),
      similarity(stripTitle(work.original_title), stripTitle(nliTitle)),
    );
    return {
      result: score >= 0.6 ? "agree" : "differ",
      nliTitle,
    };
  } catch {
    return { result: "unknown", nliTitle: null };
  }
}

/** Independently classify one unlinked cached Hebrew edition. */
export async function decideHebrewEdition(
  edition: UnlinkedHebrewEdition,
  providers: HebrewMeasureProviders,
): Promise<HebrewEditionKind> {
  let original: string | null = null;
  let wikidataTitle: string | null = null;
  let translator = "";
  let failed = false;
  try {
    original = (await providers.nliOriginal(
      edition.title,
      edition.author ?? "",
    ))?.title ?? null;
  } catch {
    failed = true;
  }
  try {
    wikidataTitle = (await providers.wikidataOriginal(edition.title))?.title ??
      null;
  } catch {
    failed = true;
  }
  try {
    translator = String(
      (await providers.bookDetails(edition.simania_id))?.translator ?? "",
    ).trim();
  } catch {
    failed = true;
  }

  original ??= wikidataTitle;
  const latinOriginal = original && /[A-Za-z]/.test(original) &&
    !HEBREW.test(original);
  if (latinOriginal) return "translation_with_original";
  if (translator) return "translated_no_original";
  if (failed) return "provider_failure";
  return "no_evidence";
}

function authorQuery(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  return words.length <= 1 ? (words[0] ?? "") : `${words[0]} ${words.at(-1)}`;
}

/**
 * Independently decide whether an in-use work has a missed Hebrew translation.
 * Provider failures are deliberately not treated as a negative measurement.
 */
export async function decideMissedTranslation(
  work: Pick<InUseWork, "original_title" | "original_authors">,
  linkedSimaniaIds: ReadonlySet<number>,
  providers: MeasureProviders,
): Promise<WorkDecision> {
  try {
    const englishAuthor = work.original_authors?.[0]?.trim() ?? "";
    if (!englishAuthor) return { missed: false, failed: false };
    const hebrewAuthor = await providers.hebrewAuthor(englishAuthor);
    if (!hebrewAuthor) return { missed: false, failed: false };

    const books = new Map<number, string>();
    const query = authorQuery(hebrewAuthor);
    for (let offset = 0; offset < 300; offset += 50) {
      const page = await providers.searchBooks(query, 50, offset);
      for (const book of page) {
        const id = simaniaId(book);
        if (
          id !== null && !linkedSimaniaIds.has(id) && HEBREW.test(book.title) &&
          similarity(hebrewAuthor, book.author ?? "") >= 0.6
        ) {
          books.set(id, book.title);
        }
      }
      if (page.length < 50) break;
    }

    for (const title of books.values()) {
      const [nli, wikidata] = await Promise.all([
        providers.nliOriginal(title, hebrewAuthor),
        providers.wikidataOriginal(title),
      ]);
      for (const original of [nli?.title, wikidata?.title]) {
        if (!original) continue;
        const score = Math.max(
          similarity(work.original_title, original),
          similarity(stripTitle(work.original_title), stripTitle(original)),
        );
        if (score >= 0.6) return { missed: true, failed: false };
      }
    }
    return { missed: false, failed: false };
  } catch {
    return { missed: false, failed: true };
  }
}

export function loadInUseWorks(sql: Sql): Promise<InUseWork[]> {
  return sql<InUseWork[]>`
    with used as (
      select work_id from public.recommendations where work_id is not null
      union
      select work_id from public.genre_recommendations where work_id is not null
      union
      select e.work_id
      from public.shelf_books as sb
      inner join public.editions as e on e.simania_id = sb.simania_id
      where e.work_id is not null
    )
    select w.id, w.original_title, w.original_authors,
      exists (
        select 1 from public.editions as e
        where e.work_id = w.id and e.simania_id > 0
      ) as has_hebrew,
      (
        select min(e.simania_id) from public.editions as e
        where e.work_id = w.id and e.simania_id > 0
      ) as simania_id
    from used
    inner join public.works as w on w.id = used.work_id
    order by w.id
  `;
}

async function loadLinkedSimaniaIds(sql: Sql): Promise<Set<number>> {
  const rows = await sql<{ simania_id: number }[]>`
    select simania_id from public.editions
    where simania_id > 0 and work_id is not null
  `;
  return new Set(rows.map((row) => Number(row.simania_id)));
}

function loadUnlinkedHebrewEditions(
  sql: Sql,
): Promise<UnlinkedHebrewEdition[]> {
  return sql<UnlinkedHebrewEdition[]>`
    select simania_id, title, author
    from public.editions
    where simania_id > 0 and work_id is null
    order by simania_id
  `;
}

async function countLinkedHebrewEditions(sql: Sql): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count
    from public.editions
    where simania_id > 0 and work_id is not null
  `;
  return Number(row?.count ?? 0);
}

function isWikimedia(input: RequestInfo | URL): boolean {
  const url = String(input instanceof Request ? input.url : input);
  return /(?:wikidata|wiktionary|wikipedia)\.org/.test(url);
}

/** Serialize Wikimedia requests, space starts by 300 ms, and retry HTTP 429. */
export function throttledWikimediaFetch(
  fetchImpl: typeof fetch,
  sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
): typeof fetch {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!isWikimedia(input)) return fetchImpl(input, init);
    const run = async (): Promise<Response> => {
      for (let attempt = 0;; attempt++) {
        const wait = Math.max(0, 300 - (Date.now() - lastStart));
        if (wait > 0) await sleep(wait);
        lastStart = Date.now();
        const response = await fetchImpl(input, init);
        if (response.status !== 429 || attempt >= 6) return response;
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await sleep((retryAfter > 0 ? retryAfter : 15) * 1000);
      }
    };
    const result = chain.then(run, run);
    chain = result.catch(() => undefined);
    return result;
  }) as typeof fetch;
}

export interface RunDeps {
  openProdDb: typeof openProdDb;
  providers: MeasureProviders;
  wrongLinkProviders: WrongLinkProviders;
  hebrewProviders: HebrewMeasureProviders;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  openProdDb,
  providers: {
    hebrewAuthor: wikidataHebrewAuthorStrict,
    searchBooks,
    nliOriginal,
    wikidataOriginal,
  },
  wrongLinkProviders: { bookDetails, nliOriginal },
  hebrewProviders: { bookDetails, nliOriginal, wikidataOriginal },
  log: console.log,
  error: console.error,
};

interface MeasureArgs {
  wrong: number | undefined;
  hebrew: boolean;
}

function parseArgs(args: string[]): MeasureArgs | null {
  let wrong: number | undefined;
  let hebrew = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--hebrew" && !hebrew) {
      hebrew = true;
      continue;
    }
    if (
      args[index] === "--wrong" && wrong === undefined &&
      /^[1-9]\d*$/.test(args[index + 1] ?? "")
    ) {
      const value = Number(args[++index]);
      if (!Number.isSafeInteger(value)) return null;
      wrong = value;
      continue;
    }
    return null;
  }
  return { wrong, hebrew };
}

export async function main(
  argsOrOverrides: string[] | Partial<RunDeps> = Deno.args,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const args = Array.isArray(argsOrOverrides) ? argsOrOverrides : Deno.args;
  const suppliedOverrides = Array.isArray(argsOrOverrides)
    ? overrides
    : argsOrOverrides;
  const requested = parseArgs(args);
  const deps = { ...runDefaults, ...suppliedOverrides };
  if (requested === null) {
    deps.error(
      "Usage: measure-links.ts [--hebrew] [--wrong <positive integer>]",
    );
    return 2;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = throttledWikimediaFetch(originalFetch);
  let sql: Sql | null = null;
  try {
    sql = await deps.openProdDb({ readOnly: true });
    const [works, linked] = await Promise.all([
      loadInUseWorks(sql),
      loadLinkedSimaniaIds(sql),
    ]);
    const unlinked = works.filter((work) => !work.has_hebrew);
    const missedTitles: string[] = [];
    let failed = 0;
    // Deliberately sequential: providers and the Wikimedia throttle get one work at a time.
    for (const work of unlinked) {
      const decision = await decideMissedTranslation(
        work,
        linked,
        deps.providers,
      );
      if (decision.missed) missedTitles.push(work.original_title);
      if (decision.failed) failed++;
    }
    let wrongSample: Record<string, unknown> | undefined;
    if (requested.wrong !== undefined) {
      const linkedWorks = works.filter((work) => work.simania_id !== null);
      const sample = sampleLinkedWorks(linkedWorks, requested.wrong);
      let agree = 0;
      let differ = 0;
      let unknown = 0;
      const differTitles: [string, string][] = [];
      for (const work of sample) {
        const decision = await decideWrongLink(work, deps.wrongLinkProviders);
        if (decision.result === "agree") agree++;
        else if (decision.result === "differ") {
          differ++;
          differTitles.push([work.original_title, decision.nliTitle!]);
        } else unknown++;
      }
      wrongSample = {
        n: sample.length,
        agree,
        differ,
        unknown,
        differ_titles: differTitles,
      };
    }
    let hebrew: Record<string, number> | undefined;
    if (requested.hebrew) {
      const [editions, linkedEditions] = await Promise.all([
        loadUnlinkedHebrewEditions(sql),
        countLinkedHebrewEditions(sql),
      ]);
      const counts: Record<HebrewEditionKind, number> = {
        translation_with_original: 0,
        translated_no_original: 0,
        no_evidence: 0,
        provider_failure: 0,
      };
      // Deliberately sequential: Wikimedia calls share the global throttle.
      for (const edition of editions) {
        counts[await decideHebrewEdition(edition, deps.hebrewProviders)]++;
      }
      hebrew = {
        unlinked_editions: editions.length,
        ...counts,
        linked_editions: linkedEditions,
      };
    }
    deps.log(JSON.stringify({
      in_use_works: works.length,
      unlinked_in_use: unlinked.length,
      missed: missedTitles.length,
      missed_rate: works.length
        ? Number((missedTitles.length / works.length).toFixed(4))
        : 0,
      missed_titles: missedTitles,
      ...(failed > 0 ? { failed } : {}),
      ...(wrongSample ? { wrong_sample: wrongSample } : {}),
      ...(hebrew ? { hebrew } : {}),
    }));
    return 0;
  } finally {
    await sql?.end();
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Link measurement failed.",
    );
    Deno.exit(1);
  }
}
