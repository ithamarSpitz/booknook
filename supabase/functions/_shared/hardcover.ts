import { fetchTimeout, HttpError, normalize, similarity } from "./utils.ts";
import { nameSoundScore } from "./names.ts";

const HARDCOVER = "https://api.hardcover.app/v1/graphql";

export type HardcoverBook = {
  id: number;
  title: string;
  slug?: string;
  users_read_count?: number;
  cached_contributors?: Array<{ author?: { name?: string } }>;
  cached_similar_book_ids?: number[];
  cached_tags?: unknown;
  image?: { url?: string | null } | null;
};

export type HardcoverEnglishBook = HardcoverBook & {
  description?: string | null;
  rating?: number | null;
  ratings_count?: number | null;
  pages?: number | null;
  release_year?: number | null;
  default_physical_edition?: {
    pages?: number | null;
    publisher?: { name?: string | null } | null;
  } | null;
};

export function authors(book: HardcoverBook): string[] {
  return (book.cached_contributors ?? []).map((item) => item?.author?.name).filter(Boolean) as string[];
}

async function graphql<T>(query: string): Promise<T> {
  const token = Deno.env.get("HARDCOVER_API_KEY")?.trim();
  if (!token) throw new HttpError(500, "HARDCOVER_API_KEY is not configured for the local functions.");
  const response = await fetchTimeout(HARDCOVER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  }, 18000);
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new HttpError(502, payload.errors?.[0]?.message ?? `Hardcover returned HTTP ${response.status}.`);
  }
  return payload.data as T;
}

export type FindHardcoverBookOptions = {
  requireAuthor?: boolean;
  retryWithAuthor?: boolean;
  soundAuthor?: string;
};

function authorBoost(
  authorHint: string,
  soundAuthor: string,
  book: HardcoverBook,
): number {
  const bookAuthors = authors(book);
  if (
    (authorHint.trim() &&
      bookAuthors.some((author) => similarity(authorHint, author) > 0.45)) ||
    (soundAuthor.trim() && nameSoundScore(soundAuthor, bookAuthors) >= 0.6)
  ) return 2;
  return 0;
}

function firstContributorNormalized(book: HardcoverBook): string {
  return normalize(authors(book)[0] ?? "");
}

function rankHardcoverBooks(
  books: HardcoverBook[],
  authorHint: string,
  soundAuthor: string,
  titleDiceFor: (book: HardcoverBook) => number,
  requireAuthor: boolean,
): HardcoverBook | null {
  const ranked = books.map((book) => {
    const titleDice = titleDiceFor(book);
    let score = titleDice * 3;
    const boost = authorBoost(authorHint, soundAuthor, book);
    score += boost;
    score += Math.log10(1 + (book.users_read_count ?? 0)) / 20;
    return { book, score, titleDice, boost };
  }).sort((a, b) => b.score - a.score || a.book.id - b.book.id);
  const top = ranked[0];
  if (!top || top.titleDice < 0.5) return null;
  if (requireAuthor && top.boost === 0) return null;
  if (top.boost === 0) {
    const topAuthor = firstContributorNormalized(top.book);
    for (const entry of ranked.slice(1)) {
      if (entry.titleDice !== top.titleDice) continue;
      if (firstContributorNormalized(entry.book) !== topAuthor) return null;
    }
  }
  return top.book;
}

async function searchHardcoverDetails(query: string): Promise<HardcoverBook[]> {
  const safe = query.replace(/[\\"]/g, " ").trim();
  const search = await graphql<{ search?: { ids?: Array<string | number> } }>(
    `query { search(query: "${safe}", query_type: "Book", per_page: 8) { ids } }`,
  );
  const ids = (search.search?.ids ?? []).map(Number).filter(Number.isFinite);
  return ids.length ? await hardcoverBooks(ids) : [];
}

export async function findHardcoverBook(
  originalTitle: string,
  authorHint = "",
  options?: FindHardcoverBookOptions,
): Promise<HardcoverBook | null> {
  const soundAuthor = options?.soundAuthor ?? "";
  const details = await searchHardcoverDetails(originalTitle);
  const firstMatch = rankHardcoverBooks(
    details,
    authorHint,
    soundAuthor,
    (book) => similarity(originalTitle, book.title),
    options?.requireAuthor ?? false,
  );
  if (firstMatch) return firstMatch;
  if (!options?.retryWithAuthor || !/[A-Za-z]/.test(authorHint)) return null;

  const retryQuery = `${originalTitle} ${authorHint}`.replace(/[\\"]/g, " ").trim();
  const search = await graphql<{
    search?: { ids?: Array<string | number>; results?: unknown };
  }>(
    `query { search(query: "${retryQuery}", query_type: "Book", per_page: 8) { ids results } }`,
  );
  const retryIds = (search.search?.ids ?? []).map(Number).filter(Number.isFinite);
  const retryDetails = retryIds.length ? await hardcoverBooks(retryIds) : [];
  const alternatives = alternativeTitlesById(search.search?.results);
  return rankHardcoverBooks(
    retryDetails,
    authorHint,
    soundAuthor,
    (book) => {
      const beforeColon = book.title.split(":", 1)[0].trim();
      let best = Math.max(
        similarity(originalTitle, book.title),
        similarity(originalTitle, beforeColon),
      );
      for (const alt of alternatives.get(Number(book.id)) ?? []) {
        best = Math.max(best, similarity(originalTitle, alt));
      }
      return best;
    },
    true,
  );
}

/** Map numeric book id to `alternative_titles` from a search `results` payload. */
function alternativeTitlesById(results: unknown): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const hits = (results as { hits?: unknown } | null | undefined)?.hits;
  if (!Array.isArray(hits)) return map;
  for (const hit of hits) {
    const doc = (hit as { document?: { id?: unknown; alternative_titles?: unknown } } | null)
      ?.document;
    if (!doc || typeof doc.id !== "string") continue;
    const id = Number(doc.id);
    if (!Number.isFinite(id) || !Array.isArray(doc.alternative_titles)) continue;
    map.set(
      id,
      doc.alternative_titles.filter((t): t is string => typeof t === "string"),
    );
  }
  return map;
}

export async function hardcoverBooks(ids: number[]): Promise<HardcoverBook[]> {
  if (!ids.length) return [];
  const data = await graphql<{ books?: HardcoverBook[] }>(
    `query { books(where:{id:{_in:${JSON.stringify(ids)}}}) { id title slug users_read_count cached_contributors cached_similar_book_ids cached_tags image { url } } }`,
  );
  return data.books ?? [];
}

/** Search Hardcover's Book index and return provider IDs in relevance order. */
export async function searchHardcoverBooks(query: string): Promise<number[]> {
  const safe = query.replace(/[\\"]/g, " ").trim();
  const data = await graphql<{ search?: { ids?: Array<string | number> } }>(
    `query { search(query: "${safe}", query_type: "Book", per_page: 8) { ids } }`,
  );
  return (data.search?.ids ?? []).map(Number).filter(Number.isFinite);
}

/** Detailed Hardcover rows used to create and refresh English editions. */
export async function hardcoverEnglishBooks(
  ids: number[],
): Promise<HardcoverEnglishBook[]> {
  if (!ids.length) return [];
  const data = await graphql<{ books?: HardcoverEnglishBook[] }>(
    `query { books(where:{id:{_in:${JSON.stringify(ids)}}}) { id title slug users_read_count cached_contributors cached_similar_book_ids cached_tags image { url } description rating ratings_count pages release_year default_physical_edition { pages publisher { name } } } }`,
  );
  return data.books ?? [];
}

