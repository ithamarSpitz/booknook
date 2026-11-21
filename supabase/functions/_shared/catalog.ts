import {
  type AuthorStore,
  catalogAuthorStore,
  englishNames,
} from "./authors.ts";
import {
  nliOriginal,
  wikidataEnglishAuthor,
  wikidataOriginal,
} from "./bridges.ts";
import {
  authors,
  findHardcoverBook,
  type HardcoverBook,
  hardcoverBooks,
  isSearchDocumentBook,
} from "./hardcover.ts";
import { type ChunkQueryResult, selectInChunks } from "./chunked.ts";
import { authorGuardRejects } from "./fallback-match.ts";
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
import { HttpError, normalize, similarity } from "./utils.ts";

export interface CatalogDb {
  from(table: string): any;
}

export interface CatalogProviders {
  bookDetails: typeof bookDetails;
  bookRating: typeof bookRating;
  wikidataOriginal: typeof wikidataOriginal;
  nliOriginal: typeof nliOriginal;
  wikidataEnglishAuthor: typeof wikidataEnglishAuthor;
  findHardcoverBook: typeof findHardcoverBook;
  hardcoverBooks: typeof hardcoverBooks;
  now: () => Date;
}

const providers: CatalogProviders = {
  bookDetails,
  bookRating,
  wikidataOriginal,
  nliOriginal,
  wikidataEnglishAuthor,
  findHardcoverBook,
  hardcoverBooks,
  now: () => new Date(),
};

/**
 * Operator resolver scripts expose a deliberately read-only CatalogDb adapter.
 * They can still perform the authors-table lookup, but cannot cache a provider
 * answer. Edge Function clients have the normal mutation methods and keep the
 * persistent authors-table behavior.
 */
function resolveAuthorStore(db: CatalogDb): AuthorStore {
  const store = catalogAuthorStore(db);
  if (typeof db.from("authors")?.insert === "function") return store;
  return {
    ...store,
    create: async () => crypto.randomUUID(),
    addNames: async () => {},
    merge: async () => {},
    markWikidataChecked: async () => {},
    markSoundChecked: async () => {},
  };
}

const DAY = 86_400_000;

const EDITION_LABEL = /מהדורה|מהדורת|עטיפת|כריכה|הדפסה|כרכים/;

/** Simania display title with trailing edition labels removed for provider matching. */
export function matchTitle(title: string): string {
  const trimmed = title.replace(/\s+/g, " ").trim();
  let result = trimmed;
  for (;;) {
    let next = result.replace(/\s*\[[^\]]*\]$/, "");
    if (next !== result) {
      result = next.trim();
      continue;
    }
    next = result.replace(/\s*\([^)]*\)$/, "");
    if (next !== result) {
      result = next.trim();
      continue;
    }
    const labelled = result.match(
      /^(.*\S)\s+[-–]\s+(?!.*\s[-–]\s)(.*)$/,
    );
    if (labelled && EDITION_LABEL.test(labelled[2])) {
      result = labelled[1].trim();
      continue;
    }
    break;
  }
  return result === "" ? trimmed : result;
}

const BOX_WORDS = ["מארז", "טרילוגיית", "טרילוגיה", "ערכת", "סט"];
const BOX_NOISE_WORDS = ["מלא", "דיגיטלי", "דיגיטלית"];
const NOT_WORD = "[^\\s\\-–()\\[\\]]";

function wordPattern(words: string[]): RegExp {
  return new RegExp(`(?<!${NOT_WORD})(?:${words.join("|")})(?!${NOT_WORD})`, "g");
}

/** True when the match title contains a box-set word as a whole word. */
export function isBoxSet(matchTitle: string): boolean {
  return wordPattern(BOX_WORDS).test(matchTitle);
}

/** Match title without box-set words, keeping the longest ` - ` / ` – ` part. */
export function boxCore(matchTitle: string): string {
  const stripped = matchTitle
    .replace(wordPattern([...BOX_WORDS, ...BOX_NOISE_WORDS]), " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = stripped.split(/(?:^|\s)[-–](?:\s|$)/).map((part) => part.trim());
  let best = "";
  for (const part of parts) if (part.length > best.length) best = part;
  return best;
}

const BOX_SUFFIXES = ["Trilogy", "Collection", "Box Set"];

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

/** Simania details and rating fetched by the browser (see public/js/simania.js). */
export type SuppliedSimania = {
  details: SimaniaBookDetails;
  rating: SimaniaBookRating | null;
};

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validates the optional `simania` request field; absent means null. */
export function suppliedSimania(value: unknown): SuppliedSimania | null {
  if (value === undefined || value === null) return null;
  if (
    !plainObject(value) || !plainObject(value.details) ||
    !(value.rating === undefined || value.rating === null ||
      plainObject(value.rating))
  ) {
    throw new HttpError(400, "simania must be {details, rating}.");
  }
  return {
    details: value.details as SimaniaBookDetails,
    rating: (value.rating ?? null) as SimaniaBookRating | null,
  };
}

/** Provider overrides that serve supplied data instead of calling Simania. */
export function suppliedProviders(
  supplied: SuppliedSimania | null,
): Partial<CatalogProviders> {
  return supplied
    ? {
      bookDetails: () => Promise.resolve(supplied.details),
      bookRating: () => Promise.resolve(supplied.rating),
    }
    : {};
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

  let details: SimaniaBookDetails | null;
  let rating: SimaniaBookRating | null;
  try {
    [details, rating] = await Promise.all([
      api.bookDetails(simaniaId),
      api.bookRating(simaniaId),
    ]);
  } catch (error) {
    // A stale cached row is still a valid book; only a new row needs details.
    if (existing) return existing;
    throw error;
  }
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

/** Upsert the canonical work fields shared by resolution and English editions. */
export async function upsertWork(
  db: CatalogDb,
  book: HardcoverBook,
  now: Date,
): Promise<string> {
  const workValues = {
    hardcover_id: book.id,
    original_title: book.title,
    original_authors: authors(book),
    similar_ids: book.cached_similar_book_ids ?? [],
    tags: cachedTags(book),
    hardcover_cover_url: coverUrl(book),
    refreshed_at: now.toISOString(),
  } satisfies Omit<WorkRow, "id">;
  const workResult = await db.from("works").upsert(workValues, {
    onConflict: "hardcover_id",
    defaultToNull: false,
  }).select("id").single();
  if (workResult.error) dbFailure(workResult.error);
  return workResult.data.id;
}

function seriesPrefixRest(
  title: string,
  seriesRaw: string | null | undefined,
): string | null {
  const series = seriesRaw?.trim();
  if (!series) return null;
  for (const dash of ["-", "–"]) {
    const prefix = `${series} ${dash} `;
    if (title.startsWith(prefix)) {
      const rest = title.slice(prefix.length).trim();
      if (!rest || /^(כרך|ספר|חלק)\s*\S+$/.test(rest)) return null;
      return rest;
    }
  }
  return null;
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

async function englishAuthorHint(
  db: CatalogDb,
  edition: EditionRow,
): Promise<string | null> {
  const author = edition.author?.trim();
  if (!author) return null;

  const editionsResult = await db.from("editions")
    .select("work_id")
    .eq("author", author)
    .not("work_id", "is", null)
    .neq("simania_id", edition.simania_id)
    .order("resolved_at", { ascending: false })
    .limit(5);
  if (editionsResult.error) return null;

  const linked = editionsResult.data as { work_id: string }[] | null;
  if (!linked?.length) return null;

  const workIds = [...new Set(linked.map((row) => row.work_id))];
  const worksResult = await selectInChunks(
    workIds,
    (chunk) =>
      db.from("works")
        .select("id, original_authors")
        .in("id", chunk) as PromiseLike<
          ChunkQueryResult<
            Pick<WorkRow, "id" | "original_authors">,
            { message?: string }
          >
        >,
  );
  if (worksResult.error) return null;

  const authorsByWorkId = new Map(
    worksResult.data.map((
      work,
    ) => [work.id, work.original_authors]),
  );

  for (const row of linked) {
    const first = authorsByWorkId.get(row.work_id)?.[0]?.trim();
    if (first) return first;
  }
  return null;
}

function guardRejects(edition: EditionRow, match: HardcoverBook): boolean {
  return authorGuardRejects(edition.author, authors(match), "");
}

/** True when only the part of bookTitle before its first colon matches the bridge title. */
export function isPrefixOnlyMatch(bridgeTitle: string, bookTitle: string): boolean {
  const colon = bookTitle.indexOf(":");
  if (colon < 0) return false;
  return similarity(bridgeTitle, bookTitle) < 0.9 &&
    similarity(bridgeTitle, bookTitle.slice(0, colon)) >= 0.9;
}

export type ResolveMatchResult = {
  found: { book: HardcoverBook; status: "wikidata" | "nli" | "fuzzy" } | null;
  failed: boolean;
};

/** Wikidata -> NLI -> fuzzy decision. Never writes; ignores resolve_status. */
export async function resolveMatch(
  db: CatalogDb,
  edition: EditionRow,
  overrides: Partial<CatalogProviders> = {},
): Promise<ResolveMatchResult> {
  const api = { ...providers, ...overrides };
  let match: HardcoverBook | null = null;
  let status: "wikidata" | "nli" | "fuzzy" = "fuzzy";
  let wikidataTitle = "";
  let weakWikidata = false;
  // A provider error is not evidence that the book is missing. If nothing matched
  // and any request failed, stay pending so the next request retries.
  const failures = { count: 0 };
  const fullTitle = matchTitle(edition.title);
  const box = isBoxSet(fullTitle);
  const titleForMatch = box ? boxCore(fullTitle) : fullTitle;

  const matchBridge = async (
    bridgeTitle: string,
    hint: string | undefined,
    options: Parameters<typeof findHardcoverBook>[2],
  ): Promise<HardcoverBook | null> => {
    if (!box) {
      return await tryMatch(
        () => api.findHardcoverBook(bridgeTitle, hint, options),
        failures,
      );
    }
    for (const suffix of BOX_SUFFIXES) {
      const found = await tryMatch(
        () =>
          api.findHardcoverBook(`${bridgeTitle} ${suffix}`, hint, {
            requireAuthor: true,
            boxTitle: true,
          }),
        failures,
      );
      if (found && !guardRejects(edition, found)) return found;
    }
    return null;
  };

  try {
    const bridge = await api.wikidataOriginal(titleForMatch);
    wikidataTitle = bridge?.title ?? "";
    if (bridge) {
      match = await matchBridge(bridge.title, bridge.author, { retryWithAuthor: true });
    }
    if (match && guardRejects(edition, match)) match = null;
    if (match) {
      status = "wikidata";
      weakWikidata = !!bridge && isPrefixOnlyMatch(bridge.title, match.title);
    }
  } catch {
    failures.count += 1;
  }

  if (!match || weakWikidata) {
    try {
      let nli = await api.nliOriginal(
        titleForMatch,
        edition.author ?? "",
      );
      if (nli === null) {
        const rest = seriesPrefixRest(titleForMatch, edition.series);
        if (rest) nli = await api.nliOriginal(rest, edition.author ?? "");
      }
      const bridge = nli;
      if (bridge && normalize(bridge.title) !== normalize(wikidataTitle)) {
        let hint = await englishAuthorHint(db, edition);
        if (hint === null) hint = bridge.versoAuthor?.trim() || null;
        if (hint === null && edition.author?.trim()) {
          try {
            const names = await englishNames(resolveAuthorStore(db), edition.author, {
              wikidataEnglishAuthorStrict: api.wikidataEnglishAuthor,
              now: api.now,
            });
            hint = names[0] ?? null;
          } catch {
            failures.count += 1;
          }
        }
        const nliOptions = hint === null
          ? { retryWithAuthor: true, soundAuthor: edition.author ?? "" }
          : { retryWithAuthor: true };
        let found = await matchBridge(bridge.title, hint ?? bridge.author, nliOptions);
        if (found && guardRejects(edition, found)) found = null;
        if (found && weakWikidata && isPrefixOnlyMatch(bridge.title, found.title)) {
          found = null;
        }
        if (found) {
          match = found;
          status = "nli";
        }
      }
    } catch {
      failures.count += 1;
    }
  }

  if (!match && !box) {
    match = await tryMatch(
      () => api.findHardcoverBook(titleForMatch, edition.author ?? "", { requireAuthor: true }),
      failures,
    );
    if (match && guardRejects(edition, match)) match = null;
    if (match) status = "fuzzy";
  }

  return {
    found: match ? { book: match, status } : null,
    failed: failures.count > 0,
  };
}

export async function ensureResolved(
  db: CatalogDb,
  edition: EditionRow,
  overrides: Partial<CatalogProviders> = {},
): Promise<EditionRow> {
  if (edition.simania_id < 0) return edition;
  const api = { ...providers, ...overrides };
  const now = api.now();
  if (
    edition.resolve_status !== "pending" &&
    !(edition.resolve_status === "not_found" &&
      stale(edition.resolved_at, 14, now))
  ) return edition;

  const resolved = await resolveMatch(db, edition, overrides);
  let match = resolved.found?.book ?? null;
  let status: ResolveStatus = resolved.found?.status ?? "not_found";
  const failures = { count: resolved.failed ? 1 : 0 };

  // Only a book built from search documents lacks details; stubs and detail-built books keep theirs.
  if (match && match.cached_similar_book_ids === undefined && isSearchDocumentBook(match)) {
    try {
      match = (await api.hardcoverBooks([match.id]))[0] ?? null;
    } catch {
      match = null;
    }
    if (!match) failures.count += 1;
  }

  let workId: string | null = null;
  if (match) {
    workId = await upsertWork(db, match, now);
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
    english_edition: edition.simania_id < 0,
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
