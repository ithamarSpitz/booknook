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

function parseMcp(raw: string): SimaniaBook[] {
  const line = raw.split(/\r?\n/).find((value) => value.startsWith("data:"));
  const envelope = JSON.parse(line ? line.slice(5).trim() : raw);
  const text = (envelope.result?.content ?? [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  const data = JSON.parse(text || "[]");
  if (Array.isArray(data)) return data;
  return data.books ?? data.results ?? data.items ?? data.data ?? [];
}

export async function searchBooks(query: string, limit = 8): Promise<SimaniaBook[]> {
  const value = query.trim();
  if (value.length < 2) return [];
  const response = await fetchTimeout(SIMANIA, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: { name: "books_search", arguments: { query: value, limit, offset: 0 } },
    }),
  });
  if (!response.ok) throw new HttpError(502, `Book catalog returned HTTP ${response.status}.`);
  return parseMcp(await response.text());
}

export async function matchHebrewBook(title: string, author = ""): Promise<SimaniaBook | null> {
  let results = await searchBooks(`${title} ${author}`.trim(), 6);
  if (!results.length) results = await searchBooks(title, 6);
  const ranked = results.map((book) => ({
    book,
    score: similarity(title, book.title) * 3 + (author ? similarity(author, book.author) * 2 : 0),
  })).sort((a, b) => b.score - a.score);
  return ranked[0] && similarity(title, ranked[0].book.title) >= 0.45 ? ranked[0].book : null;
}

export function simaniaKey(book: SimaniaBook): string {
  const id = book.id ?? book.bookId;
  return id != null ? `id:${id}` : `text:${normalize(book.title)}|${normalize(book.author)}`;
}

