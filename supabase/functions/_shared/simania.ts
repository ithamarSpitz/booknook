import { fetchTimeout, HttpError, normalize, similarity } from "./utils.ts";

const SIMANIA = "https://simania.co.il/api/mcp";
let requestId = 0;

export type SimaniaBook = {
  id?: string | number;
  bookId?: string | number;
  title: string;
  author?: string;
  year?: string | number;
  coverUrl?: string;
  url?: string;
};

export type SimaniaBookDetails = Record<string, unknown> & {
  id?: string | number;
  bookId?: string | number;
  title?: string;
};

export type SimaniaBookRating = Record<string, unknown>;

function parseMcp(raw: string): unknown {
  const line = raw.split(/\r?\n/).find((value) => value.startsWith("data:"));
  const envelope = JSON.parse(line ? line.slice(5).trim() : raw);
  const text = (envelope.result?.content ?? [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  return JSON.parse(text || "null");
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchTimeout(SIMANIA, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "Torimitor/0.1 (personal Hebrew reading list)",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) {
    throw new HttpError(502, `Book catalog returned HTTP ${response.status}.`);
  }
  try {
    return parseMcp(await response.text());
  } catch {
    throw new HttpError(502, "Book catalog returned an invalid response.");
  }
}

export async function searchBooks(
  query: string,
  limit = 8,
): Promise<SimaniaBook[]> {
  const value = query.trim();
  if (value.length < 2) return [];
  const data = await callTool("books_search", {
    query: value,
    limit,
    offset: 0,
  }) as Record<string, unknown> | unknown[];
  if (Array.isArray(data)) return data as SimaniaBook[];
  return (data?.books ?? data?.results ?? data?.items ?? data?.data ??
    []) as SimaniaBook[];
}

function objectResult(
  value: unknown,
  keys: string[],
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object"
      ? value[0] as Record<string, unknown>
      : null;
  }
  if (typeof value === "number") return { rating: value };
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const nested = object[key];
    if (Array.isArray(nested)) {
      return nested[0] && typeof nested[0] === "object"
        ? nested[0] as Record<string, unknown>
        : null;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return object;
}

export async function bookDetails(
  id: number,
): Promise<SimaniaBookDetails | null> {
  return objectResult(await callTool("books_get_details", { bookId: id }), [
    "book",
    "details",
    "data",
    "result",
  ]);
}

export async function bookRating(
  id: number,
): Promise<SimaniaBookRating | null> {
  return objectResult(await callTool("books_get_rating", { bookId: id }), [
    "ratings",
    "data",
    "result",
  ]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function fetchEditionDetails(
  simaniaId: number,
): Promise<Record<string, unknown>> {
  const [details, rating] = await Promise.all([
    bookDetails(simaniaId),
    bookRating(simaniaId),
  ]);
  const title = stringValue(details?.title ?? details?.bookTitle);
  if (!title) {
    throw new HttpError(502, "Book catalog did not return book details.");
  }
  return {
    simania_id: simaniaId,
    title,
    author: stringValue(details?.author),
    translator: stringValue(details?.translator),
    publisher: stringValue(details?.publisher),
    series: stringValue(details?.series),
    category: stringValue(details?.category),
    year: numberValue(details?.year),
    pages: numberValue(details?.pages),
    description: stringValue(details?.description),
    cover_url: stringValue(details?.coverUrl ?? details?.cover_url),
    simania_rating: numberValue(
      rating?.rating ?? rating?.average ?? rating?.averageRating,
    ),
    simania_rating_count: numberValue(
      rating?.count ?? rating?.ratingCount ?? rating?.votes,
    ),
    details_at: new Date().toISOString(),
  };
}

export async function matchHebrewBook(
  title: string,
  author = "",
): Promise<SimaniaBook | null> {
  let results = await searchBooks(`${title} ${author}`.trim(), 6);
  if (!results.length) results = await searchBooks(title, 6);
  const ranked = results.map((book) => ({
    book,
    score: similarity(title, book.title) * 3 +
      (author ? similarity(author, book.author) * 2 : 0),
  })).sort((a, b) => b.score - a.score);
  return ranked[0] && similarity(title, ranked[0].book.title) >= 0.45
    ? ranked[0].book
    : null;
}

export function simaniaKey(book: SimaniaBook): string {
  const id = book.id ?? book.bookId;
  return id != null
    ? `id:${id}`
    : `text:${normalize(book.title)}|${normalize(book.author)}`;
}
