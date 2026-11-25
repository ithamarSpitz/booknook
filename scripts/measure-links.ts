import { setProviderRetry } from "../supabase/functions/_shared/utils.ts";
import { setProviderRetry as setSimaniaRetry } from "../public/js/simania.js";
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
import { sameAuthor } from "../supabase/functions/_shared/author-sound.ts";
import { similarity } from "../supabase/functions/_shared/utils.ts";
import { authorAgreesWithWork } from "./lib/rematch.ts";
import { openProdDb } from "./lib/prod-db.ts";
import { cachedFetch, type CacheStats } from "./lib/provider-cache.ts";
import { throttledWikimediaFetch } from "./lib/provider-throttle.ts";

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
  /** Only set when asked for with `withBook`. */
  book?: { simania_id: number; title: string };
}

export interface WikidataWorkEntity {
  id: string;
  hebrewLabel: string | null;
}

export type UnlinkedWorkClass =
  | "missed"
  | "hebrew_label_unconfirmed"
  | "no_evidence"
  | "failed";

export interface UnlinkedWorkDecision {
  class: UnlinkedWorkClass;
  via?: "existing" | "wikidata_he";
  hebrewLabel?: string;
}

export interface UnlinkedEvidenceProviders extends MeasureProviders {
  wikidataWork: (
    work: Pick<InUseWork, "original_title" | "original_authors">,
  ) => Promise<WikidataWorkEntity | null>;
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
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

type WikidataEntity = {
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<
    string,
    Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>
  >;
};

async function wikidataJson(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const url = new URL(WIKIDATA_API);
  for (
    const [key, value] of Object.entries({
      ...params,
      format: "json",
      origin: "*",
    })
  ) url.searchParams.set(key, value);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Wikidata returned HTTP ${response.status}.`);
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || "error" in value) {
    throw new Error("Wikidata returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function normalizedWords(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

function authorEvidenceAgrees(evidence: string, authors: string[]): boolean {
  const words = new Set(normalizedWords(evidence));
  return authors.some((author) => {
    if (sameAuthor(evidence, author)) return true;
    const surname = normalizedWords(author).at(-1);
    return Boolean(surname && words.has(surname));
  });
}

/** Find the first title-search entity supported by description or P50 author. */
export async function findWikidataWork(
  work: Pick<InUseWork, "original_title" | "original_authors">,
  fetchImpl: typeof fetch = fetch,
): Promise<WikidataWorkEntity | null> {
  const searchBody = await wikidataJson({
    action: "wbsearchentities",
    search: work.original_title,
    language: "en",
    uselang: "en",
    type: "item",
    limit: "10",
  }, fetchImpl);
  const search = Array.isArray(searchBody.search)
    ? searchBody.search as Array<{ id?: unknown }>
    : [];
  const ids = search.map((item) => String(item.id ?? "")).filter(Boolean);
  if (!ids.length) return null;

  const entityBody = await wikidataJson({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "labels|descriptions|claims",
    languages: "he|en",
  }, fetchImpl);
  const entities = (entityBody.entities ?? {}) as Record<
    string,
    WikidataEntity
  >;
  const authorIds = [
    ...new Set(
      ids.flatMap((id) =>
        (entities[id]?.claims?.P50 ?? []).map((claim) =>
          claim.mainsnak?.datavalue?.value?.id ?? ""
        ).filter(Boolean)
      ),
    ),
  ];
  let authorEntities: Record<string, WikidataEntity> = {};
  if (authorIds.length) {
    const authorBody = await wikidataJson({
      action: "wbgetentities",
      ids: authorIds.join("|"),
      props: "labels|descriptions|claims",
      languages: "en",
    }, fetchImpl);
    authorEntities = (authorBody.entities ?? {}) as Record<
      string,
      WikidataEntity
    >;
  }

  const authors = work.original_authors ?? [];
  for (const id of ids) {
    const entity = entities[id];
    if (!entity) continue;
    const description = entity.descriptions?.en?.value ?? "";
    const p50Labels = (entity.claims?.P50 ?? []).map((claim) => {
      const authorId = claim.mainsnak?.datavalue?.value?.id ?? "";
      return authorEntities[authorId]?.labels?.en?.value ?? "";
    });
    if (
      !authorEvidenceAgrees(description, authors) &&
      !p50Labels.some((label) => authorEvidenceAgrees(label, authors))
    ) continue;
    return {
      id,
      hebrewLabel: entity.labels?.he?.value?.trim() || null,
    };
  }
  return null;
}

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
  options: { withBook?: boolean } = {},
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

    for (const [bookId, title] of books) {
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
        if (score >= 0.6) {
          return options.withBook
            ? {
              missed: true,
              failed: false,
              book: { simania_id: bookId, title },
            }
            : { missed: true, failed: false };
        }
      }
    }
    return { missed: false, failed: false };
  } catch {
    return { missed: false, failed: true };
  }
}

function apostropheVariants(title: string): string[] {
  const ascii = title.replace(/[׳’]/g, "'");
  return [...new Set([ascii, ascii.replace(/'/g, "׳")])];
}

/** Give one checked unlinked work exactly one S44 class. */
export async function classifyUnlinkedWork(
  work: Pick<InUseWork, "original_title" | "original_authors">,
  linkedSimaniaIds: ReadonlySet<number>,
  providers: UnlinkedEvidenceProviders,
): Promise<UnlinkedWorkDecision> {
  const existing = await decideMissedTranslation(
    work,
    linkedSimaniaIds,
    providers,
  );
  if (existing.missed) return { class: "missed", via: "existing" };
  if (existing.failed) return { class: "failed" };

  try {
    const entity = await providers.wikidataWork(work);
    const hebrewLabel = entity?.hebrewLabel?.trim() ?? "";
    if (!entity || !hebrewLabel) return { class: "no_evidence" };

    const books: SimaniaBook[] = [];
    for (const query of apostropheVariants(hebrewLabel)) {
      books.push(...await providers.searchBooks(query, 50, 0));
    }
    const authors = work.original_authors ?? [];
    const confirmed = books.some((book) =>
      authorAgreesWithWork(String(book.author ?? ""), authors, [])
    );
    return confirmed
      ? { class: "missed", via: "wikidata_he", hebrewLabel }
      : { class: "hebrew_label_unconfirmed", hebrewLabel };
  } catch {
    return { class: "failed" };
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

export function loadAllWorks(sql: Sql): Promise<InUseWork[]> {
  return sql<InUseWork[]>`
    select w.id, w.original_title, w.original_authors,
      exists (
        select 1 from public.editions as e
        where e.work_id = w.id and e.simania_id > 0
      ) as has_hebrew,
      (
        select min(e.simania_id) from public.editions as e
        where e.work_id = w.id and e.simania_id > 0
      ) as simania_id
    from public.works as w
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

export { throttledWikimediaFetch };

export interface RunDeps {
  openProdDb: typeof openProdDb;
  loadInUseWorks: typeof loadInUseWorks;
  loadAllWorks: typeof loadAllWorks;
  loadLinkedSimaniaIds: typeof loadLinkedSimaniaIds;
  providers: UnlinkedEvidenceProviders;
  wrongLinkProviders: WrongLinkProviders;
  hebrewProviders: HebrewMeasureProviders;
  log: (message: string) => void;
  error: (message: string) => void;
}

const runDefaults: RunDeps = {
  openProdDb,
  loadInUseWorks,
  loadAllWorks,
  loadLinkedSimaniaIds,
  providers: {
    hebrewAuthor: wikidataHebrewAuthorStrict,
    searchBooks,
    nliOriginal,
    wikidataOriginal,
    wikidataWork: findWikidataWork,
  },
  wrongLinkProviders: { bookDetails, nliOriginal },
  hebrewProviders: { bookDetails, nliOriginal, wikidataOriginal },
  log: console.log,
  error: console.error,
};

interface MeasureArgs {
  wrong: number | undefined;
  hebrew: boolean;
  all: boolean;
  sample: number | undefined;
  cacheDir: string | undefined;
}

function parseArgs(args: string[]): MeasureArgs | null {
  let wrong: number | undefined;
  let hebrew = false;
  let all = false;
  let sample: number | undefined;
  let cacheDir: string | undefined;
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
    if (
      args[index] === "--cache-dir" && cacheDir === undefined &&
      (args[index + 1] ?? "") !== ""
    ) {
      cacheDir = args[++index];
      continue;
    }
    if (args[index] === "--all" && !all) {
      all = true;
      continue;
    }
    if (
      args[index] === "--sample" && sample === undefined &&
      /^[1-9]\d*$/.test(args[index + 1] ?? "")
    ) {
      const value = Number(args[++index]);
      if (!Number.isSafeInteger(value)) return null;
      sample = value;
      continue;
    }
    return null;
  }
  if (sample !== undefined && !all) return null;
  return { wrong, hebrew, all, sample, cacheDir };
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
      "Usage: measure-links.ts [--all [--sample <positive integer>]] [--hebrew] [--wrong <positive integer>] [--cache-dir <dir>]",
    );
    return 2;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = throttledWikimediaFetch(originalFetch);
  const cacheStats: CacheStats = { hits: 0, misses: 0, stored: 0 };
  if (requested.cacheDir) {
    globalThis.fetch = cachedFetch(globalThis.fetch, {
      dir: requested.cacheDir,
      stats: cacheStats,
    });
  }
  let sql: Sql | null = null;
  try {
    sql = await deps.openProdDb({ readOnly: true });
    const [works, linked] = await Promise.all([
      requested.all ? deps.loadAllWorks(sql) : deps.loadInUseWorks(sql),
      deps.loadLinkedSimaniaIds(sql),
    ]);
    const unlinked = works.filter((work) => !work.has_hebrew);
    const checkedUnlinked = requested.sample === undefined
      ? unlinked
      : sampleLinkedWorks(unlinked, requested.sample);
    const missedTitles: string[] = [];
    const hebrewLabelTitles: string[] = [];
    const classCounts: Record<UnlinkedWorkClass, number> = {
      missed: 0,
      hebrew_label_unconfirmed: 0,
      no_evidence: 0,
      failed: 0,
    };
    // Deliberately sequential: providers and the Wikimedia throttle get one work at a time.
    for (const work of checkedUnlinked) {
      const decision = await classifyUnlinkedWork(
        work,
        linked,
        deps.providers,
      );
      classCounts[decision.class]++;
      if (decision.class === "missed") missedTitles.push(work.original_title);
      if (decision.hebrewLabel) hebrewLabelTitles.push(decision.hebrewLabel);
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
    const sampled = checkedUnlinked.length;
    const scaled = (count: number) =>
      requested.sample !== undefined && sampled
        ? Math.round(count * unlinked.length / sampled)
        : count;
    const counts = {
      missed: scaled(classCounts.missed),
      hebrew_label_unconfirmed: scaled(classCounts.hebrew_label_unconfirmed),
      no_evidence: scaled(classCounts.no_evidence),
      failed: scaled(classCounts.failed),
    };
    const missedRateLow = works.length
      ? Number((counts.missed / works.length).toFixed(4))
      : 0;
    const missedRateHigh = works.length
      ? Number((
        (counts.missed + counts.hebrew_label_unconfirmed + counts.failed) /
        works.length
      ).toFixed(4))
      : 0;
    const classification = {
      ...counts,
      missed_rate_low: missedRateLow,
      missed_rate_high: missedRateHigh,
      hebrew_label_titles: hebrewLabelTitles,
    };
    const measurement = requested.all
      ? (() => {
        return {
          all_works: works.length,
          unlinked: unlinked.length,
          sampled,
          missed_in_sample: missedTitles.length,
          failed_in_sample: classCounts.failed,
          missed_estimate: counts.missed,
          missed_rate: missedRateLow,
          missed_titles: missedTitles,
          ...classification,
        };
      })()
      : {
        in_use_works: works.length,
        unlinked_in_use: unlinked.length,
        missed_rate: missedRateLow,
        missed_titles: missedTitles,
        ...classification,
      };
    deps.log(JSON.stringify({
      ...measurement,
      ...(wrongSample ? { wrong_sample: wrongSample } : {}),
      ...(hebrew ? { hebrew } : {}),
    }));
    return 0;
  } finally {
    await sql?.end();
    globalThis.fetch = originalFetch;
    if (requested.cacheDir) {
      console.error(JSON.stringify({ cache: cacheStats }));
    }
  }
}

if (import.meta.main) {
  try {
    const policy = { timeoutMs: 25000, pauseMs: 1000 };
    setProviderRetry(policy);
    setSimaniaRetry(policy);
    Deno.exit(await main());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Link measurement failed.",
    );
    Deno.exit(1);
  }
}
