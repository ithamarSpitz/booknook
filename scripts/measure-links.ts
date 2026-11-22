import type { Sql } from "npm:postgres@3.4.5";
import {
  nliOriginal,
  wikidataHebrewAuthorStrict,
  wikidataOriginal,
} from "../supabase/functions/_shared/bridges.ts";
import {
  searchBooks,
  type SimaniaBook,
} from "../supabase/functions/_shared/simania.ts";
import { similarity } from "../supabase/functions/_shared/utils.ts";
import { openProdDb } from "./lib/prod-db.ts";

export interface InUseWork {
  id: string;
  original_title: string;
  original_authors: string[];
  has_hebrew: boolean;
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
      ) as has_hebrew
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
  log: (message: string) => void;
}

const runDefaults: RunDeps = {
  openProdDb,
  providers: {
    hebrewAuthor: wikidataHebrewAuthorStrict,
    searchBooks,
    nliOriginal,
    wikidataOriginal,
  },
  log: console.log,
};

export async function main(overrides: Partial<RunDeps> = {}): Promise<number> {
  const deps = { ...runDefaults, ...overrides };
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
    deps.log(JSON.stringify({
      in_use_works: works.length,
      unlinked_in_use: unlinked.length,
      missed: missedTitles.length,
      missed_rate: works.length
        ? Number((missedTitles.length / works.length).toFixed(4))
        : 0,
      missed_titles: missedTitles,
      ...(failed > 0 ? { failed } : {}),
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
