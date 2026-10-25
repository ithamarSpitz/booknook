// Simania MCP client that runs in the browser. Simania's Cloudflare blocks
// data-center IPs (Supabase Edge Functions get 403) but allows CORS from any
// origin, so every Simania call is made here from the reader's own connection
// and the results are sent to the Edge Functions.

const SIMANIA = "https://simania.co.il/api/mcp";
const TIMEOUT_MS = 12000;
let requestId = 0;

/** Same normalization and word-set Dice as supabase/functions/_shared/utils.ts. */
export function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function similarity(a, b) {
  const aa = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const bb = new Set(normalize(b).split(/\s+/).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common++;
  return (2 * common) / (aa.size + bb.size);
}

function parseMcp(raw) {
  const line = raw.split(/\r?\n/).find((value) => value.startsWith("data:"));
  const envelope = JSON.parse(line ? line.slice(5).trim() : raw);
  const text = (envelope.result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
  return JSON.parse(text || "null");
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {typeof fetch} [fetchImpl]
 */
export async function callTool(name, args, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(SIMANIA, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch {
    throw new Error("קטלוג הספרים לא זמין כרגע");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`קטלוג הספרים החזיר שגיאה (${response.status})`);
  try {
    return parseMcp(await response.text());
  } catch {
    throw new Error("קטלוג הספרים החזיר תשובה לא תקינה");
  }
}

/** @returns {Promise<Array<{id?: number|string, bookId?: number|string, title: string, author?: string, year?: number|string, coverUrl?: string, url?: string}>>} */
export async function searchBooks(query, limit = 8, fetchImpl = fetch) {
  const value = String(query ?? "").trim();
  if (value.length < 2) return [];
  const data = await callTool("books_search", { query: value, limit, offset: 0 }, fetchImpl);
  const list = Array.isArray(data)
    ? data
    : (data?.books ?? data?.results ?? data?.items ?? data?.data ?? []);
  return Array.isArray(list) ? list.slice(0, limit) : [];
}

function objectResult(value, keys) {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object" ? value[0] : null;
  }
  if (typeof value === "number") return { rating: value };
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      return nested[0] && typeof nested[0] === "object" ? nested[0] : null;
    }
    if (nested && typeof nested === "object") return nested;
  }
  return value;
}

/**
 * Raw Simania details and rating for one book, as the Edge Functions expect in
 * the `simania` request field. Rating failure is tolerated; details are required.
 * @returns {Promise<{details: Record<string, unknown>, rating: Record<string, unknown> | null}>}
 */
export async function fetchSimaniaPayload(simaniaId, fetchImpl = fetch) {
  const [details, rating] = await Promise.all([
    callTool("books_get_details", { bookId: simaniaId }, fetchImpl),
    callTool("books_get_rating", { bookId: simaniaId }, fetchImpl).catch(() => null),
  ]);
  const detailsObject = objectResult(details, ["book", "details", "data", "result"]);
  if (!detailsObject) throw new Error("הספר לא נמצא בקטלוג");
  return {
    details: detailsObject,
    rating: objectResult(rating, ["ratings", "data", "result"]),
  };
}

/**
 * Contract step 2 of recommendation localization: search "<title> <author>",
 * then the title alone only when that found nothing; accept the best result
 * when its title Dice is at least 0.45.
 */
export async function matchHebrewBook(title, author = "", fetchImpl = fetch) {
  let results = await searchBooks(`${title} ${author ?? ""}`.trim(), 6, fetchImpl);
  if (!results.length) results = await searchBooks(title, 6, fetchImpl);
  const ranked = results
    .map((book, index) => ({
      book,
      index,
      score: similarity(title, book.title) * 3 + (author ? similarity(author, book.author) * 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  return best && similarity(title, best.book.title) >= 0.45 ? best.book : null;
}

/** Numeric Simania ID of a search result, or null. */
export function simaniaIdOf(book) {
  const id = Number(book?.id ?? book?.bookId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
