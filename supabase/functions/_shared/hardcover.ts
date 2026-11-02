import { fetchTimeout, HttpError, normalize, similarity } from "./utils.ts";

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
};

function authorBoost(authorHint: string, book: HardcoverBook): number {
  if (!authorHint.trim()) return 0;
  return authors(book).some((author) => similarity(authorHint, author) > 0.45) ? 2 : 0;
}

function firstContributorNormalized(book: HardcoverBook): string {
  return normalize(authors(book)[0] ?? "");
}

export async function findHardcoverBook(
  originalTitle: string,
  authorHint = "",
  options?: FindHardcoverBookOptions,
): Promise<HardcoverBook | null> {
  const safe = originalTitle.replace(/[\\"]/g, " ").trim();
  const search = await graphql<{ search?: { ids?: Array<string | number> } }>(
    `query { search(query: "${safe}", query_type: "Book", per_page: 8) { ids } }`,
  );
  const ids = (search.search?.ids ?? []).map(Number).filter(Number.isFinite);
  if (!ids.length) return null;
  const details = await hardcoverBooks(ids);
  const ranked = details.map((book) => {
    const titleDice = similarity(originalTitle, book.title);
    let score = titleDice * 3;
    const boost = authorBoost(authorHint, book);
    score += boost;
    score += Math.log10(1 + (book.users_read_count ?? 0)) / 20;
    return { book, score, titleDice, boost };
  }).sort((a, b) => b.score - a.score || a.book.id - b.book.id);
  const top = ranked[0];
  if (!top || top.titleDice < 0.5) return null;
  if (options?.requireAuthor && top.boost === 0) return null;
  if (top.boost === 0) {
    const topAuthor = firstContributorNormalized(top.book);
    for (const entry of ranked.slice(1)) {
      if (entry.titleDice !== top.titleDice) continue;
      if (firstContributorNormalized(entry.book) !== topAuthor) return null;
    }
  }
  return top.book;
}

export async function hardcoverBooks(ids: number[]): Promise<HardcoverBook[]> {
  if (!ids.length) return [];
  const data = await graphql<{ books?: HardcoverBook[] }>(
    `query { books(where:{id:{_in:${JSON.stringify(ids)}}}) { id title slug users_read_count cached_contributors cached_similar_book_ids cached_tags image { url } } }`,
  );
  return data.books ?? [];
}

