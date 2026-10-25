import { nliOriginal, wikidataOriginal } from "./bridges.ts";
import { authors, findHardcoverBook, type HardcoverBook } from "./hardcover.ts";
import {
  bookDetails,
  bookRating,
  type SimaniaBookDetails,
  type SimaniaBookRating,
} from "./simania.ts";
import type {
  BookCard,
  CachedTags,
  EditionRow,
  ResolveStatus,
  ShelfBookRow,
  ShelfRow,
  WorkRow,
} from "./types.ts";
import { HttpError, normalize } from "./utils.ts";

export interface CatalogDb {
  from(table: string): any;
}

export interface CatalogProviders {
  bookDetails: typeof bookDetails;
  bookRating: typeof bookRating;
  wikidataOriginal: typeof wikidataOriginal;
  nliOriginal: typeof nliOriginal;
  findHardcoverBook: typeof findHardcoverBook;
  now: () => Date;
}

const providers: CatalogProviders = {
  bookDetails,
  bookRating,
  wikidataOriginal,
  nliOriginal,
  findHardcoverBook,
  now: () => new Date(),
};

const DAY = 86_400_000;

function stale(
  value: string | null | undefined,
  days: number,
  now: Date,
): boolean {
  if (!value) return true;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || now.getTime() - timestamp >= days * DAY;
}

function dbFailure(error: unknown): never {
  const message = (error as { message?: string } | null)?.message ??
    "Database operation failed.";
  throw new Error(message);
}

function stringValue(
  source: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function numberValue(
  source: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = source?.[key];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function editionValues(
  simaniaId: number,
  details: SimaniaBookDetails,
  rating: SimaniaBookRating | null,
  now: Date,
) {
  const title = stringValue(details, "title", "bookTitle", "book_name", "name");
  if (!title?.trim()) throw new HttpError(404, "Book not found.");
  return {
    simania_id: simaniaId,
    title,
    author: stringValue(
      details,
      "author",
      "authorName",
      "author_name",
      "authors",
      "writer",
    ),
    translator: stringValue(details, "translator"),
    publisher: stringValue(
      details,
      "publisher",
      "publisherName",
      "publisher_name",
    ),
    series: stringValue(details, "series"),
    category: stringValue(details, "category"),
    year: numberValue(details, "year", "publicationYear", "publication_year"),
    pages: numberValue(details, "pages", "pageCount", "page_count"),
    description: stringValue(details, "description", "summary"),
    cover_url: stringValue(
      details,
      "coverUrl",
      "cover_url",
      "imageUrl",
      "image_url",
      "cover",
      "image",
    ),
    simania_rating: numberValue(
      rating,
      "rating",
      "average",
      "averageRating",
      "average_rating",
    ),
    simania_rating_count: numberValue(
      rating,
      "count",
      "ratingCount",
      "rating_count",
      "ratingsCount",
      "votes",
    ),
    details_at: now.toISOString(),
  };
}

export async function ensureEdition(
  db: CatalogDb,
  simaniaId: number,
  overrides: Partial<CatalogProviders> = {},
): Promise<EditionRow> {
  const api = { ...providers, ...overrides };
  const existingResult = await db.from("editions").select("*").eq(
    "simania_id",
    simaniaId,
  ).maybeSingle();
  if (existingResult.error) dbFailure(existingResult.error);
  const existing = existingResult.data as EditionRow | null;
  const now = api.now();
  if (existing && !stale(existing.details_at, 30, now)) return existing;

  const [details, rating] = await Promise.all([
    api.bookDetails(simaniaId),
    api.bookRating(simaniaId),
  ]);
  if (!details) throw new HttpError(404, "Book not found.");
  const values = {
    ...editionValues(simaniaId, details, rating, now),
    work_id: existing?.work_id ?? null,
    resolve_status: existing?.resolve_status ?? "pending",
    resolved_at: existing?.resolved_at ?? null,
  };
  const result = await db.from("editions").upsert(values, {
    onConflict: "simania_id",
    defaultToNull: false,
  }).select("*").single();
  if (result.error) dbFailure(result.error);
  return result.data as EditionRow;
}

function cachedTags(book: HardcoverBook): CachedTags {
  const value = (book as unknown as { cached_tags?: unknown }).cached_tags;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const valid: CachedTags = {};
  for (const [category, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    valid[category] = entries.filter((
      entry,
    ): entry is { tag: string; [key: string]: unknown } =>
      Boolean(
        entry && typeof entry === "object" && typeof entry.tag === "string" &&
          entry.tag.trim(),
      )
    );
  }
  return valid;
}

function coverUrl(book: HardcoverBook): string | null {
  const candidate = book as unknown as Record<string, unknown>;
  return stringValue(candidate, "cover_url", "image_url") ??
    stringValue(
      candidate.image && typeof candidate.image === "object"
        ? candidate.image as Record<string, unknown>
        : null,
      "url",
    );
}

async function tryMatch(
  operation: () => Promise<HardcoverBook | null>,
  failures: { count: number },
): Promise<HardcoverBook | null> {
  try {
    return await operation();
  } catch {
    failures.count += 1;
    return null;
  }
}

export async function ensureResolved(
  db: CatalogDb,
  edition: EditionRow,
  overrides: Partial<CatalogProviders> = {},
): Promise<EditionRow> {
  const api = { ...providers, ...overrides };
  const now = api.now();
  if (
    edition.resolve_status !== "pending" &&
    !(edition.resolve_status === "not_found" &&
      stale(edition.resolved_at, 14, now))
  ) return edition;

  let match: HardcoverBook | null = null;
  let status: ResolveStatus = "not_found";
  let wikidataTitle = "";
  // A provider error is not evidence that the book is missing. If nothing matched
  // and any request failed, stay pending so the next request retries.
  const failures = { count: 0 };

  try {
    const bridge = await api.wikidataOriginal(edition.title);
    wikidataTitle = bridge?.title ?? "";
    if (bridge) {
      match = await tryMatch(
        () => api.findHardcoverBook(bridge.title, bridge.author),
        failures,
      );
    }
    if (match) status = "wikidata";
  } catch {
    failures.count += 1;
  }

  if (!match) {
    try {
      const bridge = await api.nliOriginal(edition.title, edition.author ?? "");
      if (bridge && normalize(bridge.title) !== normalize(wikidataTitle)) {
        match = await tryMatch(
          () => api.findHardcoverBook(bridge.title, bridge.author),
          failures,
        );
        if (match) status = "nli";
      }
    } catch {
      failures.count += 1;
    }
  }

  if (!match) {
    match = await tryMatch(
      () => api.findHardcoverBook(edition.title, edition.author ?? ""),
      failures,
    );
    if (match) status = "fuzzy";
  }

  let workId: string | null = null;
  if (match) {
    const workValues = {
      hardcover_id: match.id,
      original_title: match.title,
      original_authors: authors(match),
      similar_ids: match.cached_similar_book_ids ?? [],
      tags: cachedTags(match),
      hardcover_cover_url: coverUrl(match),
      refreshed_at: now.toISOString(),
    } satisfies Omit<WorkRow, "id">;
    const workResult = await db.from("works").upsert(workValues, {
      onConflict: "hardcover_id",
      defaultToNull: false,
    }).select("id").single();
    if (workResult.error) dbFailure(workResult.error);
    workId = workResult.data.id;
  }

  if (!match && failures.count > 0) status = "pending";
  const result = await db.from("editions").update({
    work_id: workId,
    resolve_status: status,
    resolved_at: status === "pending" ? null : now.toISOString(),
  }).eq("simania_id", edition.simania_id).select("*").single();
  if (result.error) dbFailure(result.error);
  return result.data as EditionRow;
}

export async function bookCard(
  db: CatalogDb,
  userId: string,
  edition: EditionRow,
): Promise<BookCard> {
  const shelfBookResult = await db.from("shelf_books").select("*")
    .eq("user_id", userId).eq("simania_id", edition.simania_id).maybeSingle();
  if (shelfBookResult.error) dbFailure(shelfBookResult.error);
  const shelfBook = shelfBookResult.data as ShelfBookRow | null;
  let shelf: Pick<ShelfRow, "id" | "name" | "kind"> | null = null;
  if (shelfBook) {
    const shelfResult = await db.from("shelves").select("id,name,kind")
      .eq("id", shelfBook.shelf_id).eq("user_id", userId).maybeSingle();
    if (shelfResult.error) dbFailure(shelfResult.error);
    shelf = shelfResult.data;
  }
  return {
    simania_id: edition.simania_id,
    work_id: edition.work_id,
    resolve_status: edition.resolve_status,
    title: edition.title,
    author: edition.author,
    translator: edition.translator,
    publisher: edition.publisher,
    series: edition.series,
    category: edition.category,
    year: edition.year,
    pages: edition.pages,
    description: edition.description,
    cover_url: edition.cover_url,
    simania_rating: edition.simania_rating === null
      ? null
      : Number(edition.simania_rating),
    simania_rating_count: edition.simania_rating_count,
    shelf_id: shelfBook?.shelf_id ?? null,
    shelf_name: shelf?.name ?? null,
    shelf_kind: shelf?.kind ?? null,
    position: shelfBook?.position ?? null,
    added_at: shelfBook?.added_at ?? null,
    finished_at: shelfBook?.finished_at ?? null,
    rating: shelfBook?.rating ?? null,
  };
}
