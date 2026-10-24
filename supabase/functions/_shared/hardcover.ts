import { fetchTimeout, HttpError, similarity } from "./utils.ts";

const HARDCOVER = "https://api.hardcover.app/v1/graphql";

export type HardcoverBook = {
  id: number;
  title: string;
  slug?: string;
  users_read_count?: number;
  cached_contributors?: Array<{ author?: { name?: string } }>;
  cached_similar_book_ids?: number[];
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

export async function findHardcoverBook(originalTitle: string, authorHint = ""): Promise<HardcoverBook | null> {
  const safe = originalTitle.replace(/[\\"]/g, " ").trim();
  const search = await graphql<{ search?: { ids?: Array<string | number> } }>(
    `query { search(query: "${safe}", query_type: "Book", per_page: 8) { ids } }`,
  );
  const ids = (search.search?.ids ?? []).map(Number).filter(Number.isFinite);
  if (!ids.length) return null;
  const details = await hardcoverBooks(ids);
  const ranked = details.map((book) => {
    let score = similarity(originalTitle, book.title) * 3;
    if (authorHint && authors(book).some((author) => similarity(authorHint, author) > 0.45)) score += 2;
    score += Math.log10(1 + (book.users_read_count ?? 0)) / 20;
    return { book, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0] && similarity(originalTitle, ranked[0].book.title) >= 0.5 ? ranked[0].book : null;
}

export async function hardcoverBooks(ids: number[]): Promise<HardcoverBook[]> {
  if (!ids.length) return [];
  const data = await graphql<{ books?: HardcoverBook[] }>(
    `query { books(where:{id:{_in:${JSON.stringify(ids)}}}) { id title slug users_read_count cached_contributors cached_similar_book_ids } }`,
  );
  return data.books ?? [];
}

