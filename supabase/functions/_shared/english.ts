import { unescape } from "jsr:@std/html@1.0.7/entities";
import entityList from "jsr:@std/html@1.0.7/named-entity-list.json" with {
  type: "json",
};
import { type CatalogDb, upsertWork } from "./catalog.ts";
import {
  authors,
  type HardcoverEnglishBook,
  hardcoverEnglishBooks,
  searchHardcoverBooks,
} from "./hardcover.ts";
import type { EditionRow, EnglishBook } from "./types.ts";
import { HttpError } from "./utils.ts";

const DAY = 86_400_000;

export interface EnglishProviders {
  searchHardcoverBooks: typeof searchHardcoverBooks;
  hardcoverEnglishBooks: typeof hardcoverEnglishBooks;
}

const providers: EnglishProviders = {
  searchHardcoverBooks,
  hardcoverEnglishBooks,
};

export function englishEditionId(hardcoverId: number): number {
  return -hardcoverId;
}

export function isEnglishEdition(simaniaId: number): boolean {
  return simaniaId < 0;
}

/** Convert Hardcover description HTML according to the edition contract. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = unescape(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
    { entityList },
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundRating(rating: number): number {
  // Shift in decimal to avoid binary multiplication moving midpoints below .5.
  const [coefficient, exponent = "0"] = rating.toString().split("e");
  return Math.round(Number(`${coefficient}e${Number(exponent) + 2}`)) / 100;
}

export function englishEditionFields(book: HardcoverEnglishBook) {
  const contributorNames = authors(book);
  const rating = finiteNumber(book.rating);
  return {
    title: book.title,
    author: contributorNames.length ? contributorNames.join(", ") : null,
    translator: null,
    publisher: book.default_physical_edition?.publisher?.name ?? null,
    series: null,
    category: null,
    year: finiteNumber(book.release_year),
    pages: finiteNumber(book.pages) ??
      finiteNumber(book.default_physical_edition?.pages),
    description: htmlToText(book.description),
    cover_url: book.image?.url ?? null,
    simania_rating: rating === null
      ? null
      : roundRating(rating),
    simania_rating_count: finiteNumber(book.ratings_count),
  };
}

function englishBook(book: HardcoverEnglishBook): EnglishBook {
  const fields = englishEditionFields(book);
  return {
    hardcover_id: book.id,
    title: fields.title,
    author: fields.author,
    year: fields.year,
    cover_url: fields.cover_url,
  };
}

function providerFailure(_error: unknown): never {
  throw new HttpError(502, "Hardcover request failed.");
}

export async function searchEnglish(
  query: string,
  overrides: Partial<EnglishProviders> = {},
): Promise<EnglishBook[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const api = { ...providers, ...overrides };
  try {
    const ids = await api.searchHardcoverBooks(trimmed);
    if (!ids.length) return [];
    const rows = await api.hardcoverEnglishBooks(ids);
    const byId = new Map(rows.map((book) => [book.id, book]));
    return ids.flatMap((id) => {
      const book = byId.get(id);
      return book ? [englishBook(book)] : [];
    });
  } catch (error) {
    providerFailure(error);
  }
}

function fresh(detailsAt: string | null, now: Date): boolean {
  if (!detailsAt) return false;
  const timestamp = Date.parse(detailsAt);
  return Number.isFinite(timestamp) && now.getTime() - timestamp < 30 * DAY;
}

function dbFailure(error: unknown): never {
  throw new Error(
    (error as { message?: string } | null)?.message ??
      "Database operation failed.",
  );
}

export async function ensureEnglishEdition(
  db: CatalogDb,
  hardcoverId: number,
  overrides: Partial<EnglishProviders> = {},
  now: Date = new Date(),
): Promise<EditionRow> {
  const simaniaId = englishEditionId(hardcoverId);
  const existingResult = await db.from("editions").select("*").eq(
    "simania_id",
    simaniaId,
  ).maybeSingle();
  if (existingResult.error) dbFailure(existingResult.error);
  const existing = existingResult.data as EditionRow | null;
  if (existing && fresh(existing.details_at, now)) return existing;

  const api = { ...providers, ...overrides };
  let book: HardcoverEnglishBook | undefined;
  try {
    book = (await api.hardcoverEnglishBooks([hardcoverId])).find((item) =>
      item.id === hardcoverId
    );
  } catch (error) {
    providerFailure(error);
  }
  if (!book) throw new HttpError(404, "Book not found on Hardcover.");

  const workId = await upsertWork(db, book, now);
  const timestamp = now.toISOString();
  const values = {
    simania_id: simaniaId,
    work_id: workId,
    resolve_status: "hardcover" as const,
    resolved_at: timestamp,
    ...englishEditionFields(book),
    details_at: timestamp,
  };
  const result = await db.from("editions").upsert(values, {
    onConflict: "simania_id",
    defaultToNull: false,
  }).select("*").single();
  if (result.error) dbFailure(result.error);
  return result.data as EditionRow;
}
