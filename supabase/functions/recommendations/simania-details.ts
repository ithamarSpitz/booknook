import { fetchTimeout, HttpError } from "../_shared/utils.ts";

const SIMANIA = "https://simania.co.il/api/mcp";
let requestId = 1000;

async function call(name: string, simaniaId: number): Promise<unknown> {
  const response = await fetchTimeout(SIMANIA, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: { name, arguments: { book_id: simaniaId } },
    }),
  });
  if (!response.ok) {
    throw new HttpError(502, `Book catalog returned HTTP ${response.status}.`);
  }
  const raw = await response.text();
  const line = raw.split(/\r?\n/).find((value) => value.startsWith("data:"));
  const envelope = JSON.parse(line ? line.slice(5).trim() : raw);
  const text = (envelope.result?.content ?? []).filter((
    item: { type?: string },
  ) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "").join("");
  return JSON.parse(text || "null");
}

function objectValue(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return objectValue(value[0]);
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  for (const key of ["book", "details", "data", "result"]) {
    if (record[key] && typeof record[key] === "object") {
      return objectValue(record[key]);
    }
  }
  return record;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function fetchEditionDetails(
  simaniaId: number,
): Promise<Record<string, unknown>> {
  const details = objectValue(await call("books_get_details", simaniaId));
  const rating = objectValue(await call("books_get_rating", simaniaId));
  const title = stringValue(details.title ?? details.bookTitle);
  if (!title) {
    throw new HttpError(502, "Book catalog did not return book details.");
  }
  return {
    simania_id: simaniaId,
    title,
    author: stringValue(details.author),
    translator: stringValue(details.translator),
    publisher: stringValue(details.publisher),
    series: stringValue(details.series),
    category: stringValue(details.category),
    year: numberValue(details.year),
    pages: numberValue(details.pages),
    description: stringValue(details.description),
    cover_url: stringValue(details.coverUrl ?? details.cover_url),
    simania_rating: numberValue(
      rating.rating ?? rating.average ?? rating.averageRating,
    ),
    simania_rating_count: numberValue(
      rating.count ?? rating.ratingCount ?? rating.votes,
    ),
    details_at: new Date().toISOString(),
  };
}
