import {
  body,
  errorResponse,
  HttpError,
  json,
  normalize,
  options,
} from "../_shared/utils.ts";
import {
  authors,
  type HardcoverBook,
  hardcoverBooks,
} from "../_shared/hardcover.ts";
import {
  nliHebrew,
  wikidataHebrew,
  wikidataHebrewAuthor,
} from "../_shared/bridges.ts";
import { ensureResolved } from "../_shared/catalog.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
import {
  buildGenreShelves,
  type GenreSeed,
  missingCandidateIds,
} from "../_shared/genres.ts";
import type {
  EditionRow,
  GenreRecommendationReplacement,
  HebrewHint,
  RecommendationCard,
  RecommendationReplacement,
  RecommendationRow,
  WorkRow,
} from "../_shared/types.ts";
import {
  cleanCachedTags,
  excludeCandidates,
  type LibraryItem,
  scoreCandidates,
  selectSeeds,
  sharedTags,
} from "./logic.ts";

type DbClient = ReturnType<typeof serviceClient>;

type GenreRecommendationInput = {
  db: DbClient;
  userId: string;
  library: LibraryItem[];
  seeds: ReturnType<typeof selectSeeds>;
  dismissed: ReadonlySet<string>;
  ordinaryRecommendations: RecommendationRow[];
  fetchHardcover: (ids: number[]) => Promise<HardcoverBook[]>;
};

export type RecommendationDependencies = {
  authenticate: (request: Request) => Promise<string>;
  userDatabase: (request: Request) => DbClient;
  serviceDatabase: () => DbClient;
  fetchHardcover: (ids: number[]) => Promise<HardcoverBook[]>;
  hebrewHint: (book: HardcoverBook) => Promise<HebrewHint | null>;
  wikidataHebrewAuthor: (englishName: string) => Promise<string | null>;
  hebrewAuthor?: (
    db: DbClient,
    englishAuthor: string,
    cache: Map<string, string | null>,
  ) => Promise<string | null>;
  ensureResolved: typeof ensureResolved;
  genreRecommendations: (input: GenreRecommendationInput) => Promise<void>;
};

export async function defaultHebrewHint(
  book: HardcoverBook,
): Promise<HebrewHint | null> {
  const author = authors(book)[0] ?? "";
  const wikidata = await wikidataHebrew(book.title, author);
  if (wikidata) {
    return {
      source: "wikidata",
      title: wikidata.title,
      author: wikidata.author || null,
    };
  }
  const nli = await nliHebrew(book.title, author);
  return nli
    ? { source: "nli", title: nli.title, author: nli.author || null }
    : null;
}

export async function hebrewAuthorFor(
  db: DbClient,
  englishAuthor: string,
  deps: Pick<RecommendationDependencies, "wikidataHebrewAuthor">,
  cache: Map<string, string | null>,
  inFlight = new Map<string, Promise<string | null>>(),
): Promise<string | null> {
  const key = normalize(englishAuthor.trim());
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = (async (): Promise<string | null> => {
    let resolved: string | null = null;
    try {
      const worksResult = await db.from("works")
        .select("id, original_authors")
        .contains("original_authors", [englishAuthor.trim()])
        .limit(50);
      if (worksResult.error) throw worksResult.error;

      const matchedWorkIds = (
        (worksResult.data ?? []) as Pick<WorkRow, "id" | "original_authors">[]
      )
        .filter((work) => normalize(work.original_authors[0] ?? "") === key)
        .map((work) => work.id);

      if (matchedWorkIds.length) {
        const editionsQuery = db.from("editions")
          .select("simania_id, author, resolved_at")
          .in("work_id", matchedWorkIds);
        const positiveEditionsQuery = "gt" in editionsQuery
          ? editionsQuery.gt("simania_id", 0)
          : editionsQuery;
        const editionsResult = await positiveEditionsQuery
          .not("work_id", "is", null)
          .order("resolved_at", { ascending: false });
        if (editionsResult.error) throw editionsResult.error;

        for (
          const row of (editionsResult.data ?? []) as {
            simania_id: number;
            author: string | null;
          }[]
        ) {
          if (row.simania_id <= 0) continue;
          const author = row.author?.trim();
          if (author) {
            resolved = author;
            break;
          }
        }
      }

      if (!resolved) {
        resolved = await deps.wikidataHebrewAuthor(englishAuthor);
      }
    } catch {
      resolved = null;
    }

    cache.set(key, resolved);
    inFlight.delete(key);
    return resolved;
  })();

  inFlight.set(key, lookup);
  return lookup;
}

const defaults: RecommendationDependencies = {
  authenticate: requireUser,
  userDatabase: userClient,
  serviceDatabase: serviceClient,
  fetchHardcover: hardcoverBooks,
  // Simania blocks data-center IPs, so the server only finds the Hebrew title;
  // the browser matches it in Simania and calls link-edition.
  hebrewHint: defaultHebrewHint,
  wikidataHebrewAuthor,
  ensureResolved,
  genreRecommendations: storeGenreRecommendations,
};

const SELF_HEAL_BUDGET_MS = 20_000;
const NOT_FOUND_RETRY_DAYS = 14;
const DAY_MS = 86_400_000;

function notFoundRetryDue(
  resolvedAt: string | null | undefined,
  now: Date,
): boolean {
  if (!resolvedAt) return true;
  const timestamp = Date.parse(resolvedAt);
  return !Number.isFinite(timestamp) ||
    now.getTime() - timestamp >= NOT_FOUND_RETRY_DAYS * DAY_MS;
}

function editionNeedsSelfHeal(edition: EditionRow, now: Date): boolean {
  if (edition.simania_id < 0) return false;
  if (edition.work_id !== null) return false;
  if (edition.resolve_status === "pending") return true;
  if (edition.resolve_status === "not_found") {
    return notFoundRetryDue(edition.resolved_at, now);
  }
  return false;
}

async function selfHealShelvedEditions(
  userDb: DbClient,
  serviceDb: DbClient,
  userId: string,
  resolve: RecommendationDependencies["ensureResolved"],
): Promise<void> {
  const { data, error } = await userDb.from("shelf_books").select(
    "added_at, editions!inner(*)",
  ).eq("user_id", userId);
  if (error) fail(error);

  const now = new Date();
  const toResolve = (data ?? [])
    .map((row: Record<string, unknown>) => {
      const edition = relation(
        row.editions as EditionRow | EditionRow[] | null,
      );
      if (!edition) return null;
      return { added_at: String(row.added_at), edition };
    })
    .filter((item): item is { added_at: string; edition: EditionRow } =>
      item !== null && editionNeedsSelfHeal(item.edition, now)
    )
    .sort((left, right) => right.added_at.localeCompare(left.added_at))
    .slice(0, 2);

  const started = Date.now();
  for (const { edition } of toResolve) {
    if (Date.now() - started >= SELF_HEAL_BUDGET_MS) break;
    try {
      await resolve(serviceDb, edition);
    } catch (error) {
      console.warn(
        `Self-heal resolution failed for ${edition.simania_id}:`,
        error,
      );
    }
  }
}

function fail(error: unknown): never {
  throw new Error(
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "Database operation failed."),
  );
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function workFromProvider(book: HardcoverBook): Omit<WorkRow, "id"> {
  return {
    hardcover_id: book.id,
    original_title: book.title,
    original_authors: authors(book),
    similar_ids: (book.cached_similar_book_ids ?? []).filter(Number.isInteger),
    tags: cleanCachedTags(book.cached_tags),
    hardcover_cover_url: book.image?.url ?? null,
    refreshed_at: new Date().toISOString(),
  };
}

async function loadLibrary(
  db: DbClient,
  userId: string,
): Promise<LibraryItem[]> {
  const { data, error } = await db.from("shelf_books").select(
    "simania_id,position,added_at,finished_at,rating,shelves!inner(kind),editions!inner(title,work_id,works(id,hardcover_id,original_title,original_authors,similar_ids,tags,hardcover_cover_url,refreshed_at))",
  ).eq("user_id", userId);
  if (error) fail(error);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const shelf = relation(
      row.shelves as { kind: string } | Array<{ kind: string }>,
    );
    const edition = relation(
      row.editions as Record<string, unknown> | Array<Record<string, unknown>>,
    );
    const work = relation(edition?.works as WorkRow | WorkRow[] | null);
    return {
      simania_id: Number(row.simania_id),
      position: Number(row.position),
      added_at: String(row.added_at),
      finished_at: row.finished_at ? String(row.finished_at) : null,
      shelf_kind: shelf?.kind ?? "",
      rating: row.rating == null ? null : Number(row.rating),
      title: String(edition?.title ?? ""),
      work,
    };
  });
}

async function loadDismissed(
  db: DbClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await db.from("recommendations").select("work_id").eq(
    "user_id",
    userId,
  ).eq("dismissed", true);
  if (error) fail(error);
  return new Set((data ?? []).map((row: { work_id: string }) => row.work_id));
}

async function loadWorks(
  db: DbClient,
  hardcoverIds: number[],
): Promise<WorkRow[]> {
  if (!hardcoverIds.length) return [];
  const { data, error } = await db.from("works").select("*").in(
    "hardcover_id",
    hardcoverIds,
  );
  if (error) fail(error);
  return (data ?? []) as WorkRow[];
}

async function loadAndStoreMissingWorks(
  db: DbClient,
  ids: number[],
  existing: WorkRow[],
  fetchBooks: RecommendationDependencies["fetchHardcover"],
): Promise<WorkRow[]> {
  const present = new Set(existing.map((work) => work.hardcover_id));
  const missing = ids.filter((id) => !present.has(id));
  const fetched: HardcoverBook[] = [];
  for (let index = 0; index < missing.length; index += 50) {
    fetched.push(...await fetchBooks(missing.slice(index, index + 50)));
  }
  if (!fetched.length) return existing;
  const missingSet = new Set(missing);
  const rows = fetched.filter((book) => missingSet.has(book.id)).map(
    workFromProvider,
  );
  const { data, error } = await db.from("works").upsert(rows, {
    onConflict: "hardcover_id",
  }).select("*");
  if (error) fail(error);
  const stored = (data ?? []) as WorkRow[];
  const storedIds = new Set(stored.map((work) => work.hardcover_id));
  return [
    ...existing.filter((work) => !storedIds.has(work.hardcover_id)),
    ...stored,
  ];
}

function genreSeeds(
  library: LibraryItem[],
  seeds: ReturnType<typeof selectSeeds>,
): GenreSeed[] {
  const result: GenreSeed[] = [];
  const seededWorks = new Set<string>();
  for (const seed of seeds) {
    if (!seed.work || seededWorks.has(seed.work.id)) continue;
    seededWorks.add(seed.work.id);
    result.push({
      workId: seed.work.id,
      simaniaId: seed.simania_id,
      weight: seed.weight,
      tags: seed.work.tags,
      similarIds: seed.work.similar_ids,
    });
  }
  for (const item of library) {
    if (
      item.shelf_kind !== "reading" || !item.work ||
      seededWorks.has(item.work.id)
    ) continue;
    seededWorks.add(item.work.id);
    result.push({
      workId: item.work.id,
      simaniaId: item.simania_id,
      weight: 2.5,
      tags: item.work.tags,
      similarIds: item.work.similar_ids,
    });
  }
  return result;
}

export async function storeGenreRecommendations({
  db,
  userId,
  library,
  seeds,
  dismissed,
  ordinaryRecommendations,
  fetchHardcover,
}: GenreRecommendationInput): Promise<void> {
  const genreSeedRows = genreSeeds(library, seeds);
  if (!genreSeedRows.length) {
    const cleared = await db.rpc("replace_genre_recommendations", {
      p_user_id: userId,
      p_rows: [],
    });
    if (cleared.error) fail(cleared.error);
    return;
  }

  const candidateIds = [
    ...new Set(
      genreSeedRows.flatMap((seed) => seed.similarIds.slice(0, 40)),
    ),
  ];
  const known = await loadWorks(db, candidateIds);
  let worksByHardcoverId = new Map(
    known.flatMap((work) =>
      work.hardcover_id === null ? [] : [[work.hardcover_id, work] as const]
    ),
  );
  const missingIds = missingCandidateIds(
    genreSeedRows,
    worksByHardcoverId,
    100,
  );
  const allWorks = await loadAndStoreMissingWorks(
    db,
    missingIds,
    known,
    fetchHardcover,
  );
  worksByHardcoverId = new Map(
    allWorks.flatMap((work) =>
      work.hardcover_id === null ? [] : [[work.hardcover_id, work] as const]
    ),
  );

  const excludedWorkIds = new Set([
    ...dismissed,
    ...library.flatMap((item) => item.work ? [item.work.id] : []),
  ]);
  const shelves = buildGenreShelves({
    seeds: genreSeedRows,
    worksByHardcoverId,
    excludedWorkIds,
  });
  const shelfWorkIds = shelves.flatMap((shelf) =>
    shelf.books.map((book) => book.workId)
  );
  const catalogEditionByWork = new Map<string, number>();
  if (shelfWorkIds.length) {
    const editions = await db.from("editions")
      .select("simania_id,work_id,resolved_at")
      .in("work_id", shelfWorkIds)
      .gt("simania_id", 0);
    if (editions.error) fail(editions.error);
    const rows = (editions.data ?? []) as Pick<
      EditionRow,
      "simania_id" | "work_id" | "resolved_at"
    >[];
    rows.sort((left, right) =>
      (right.resolved_at ?? "").localeCompare(left.resolved_at ?? "")
    );
    for (const edition of rows) {
      if (
        edition.work_id && edition.simania_id > 0 && edition.resolved_at &&
        !catalogEditionByWork.has(edition.work_id)
      ) {
        catalogEditionByWork.set(edition.work_id, edition.simania_id);
      }
    }
  }
  const recommendationEditionByWork = new Map(
    ordinaryRecommendations.map((row) => [row.work_id, row.simania_id]),
  );
  const replacements: GenreRecommendationReplacement[] = shelves.flatMap(
    (shelf, shelfPosition) =>
      shelf.books.map((book, position) => ({
        work_id: book.workId,
        genre: shelf.genre,
        shelf_position: shelfPosition,
        position,
        simania_id: recommendationEditionByWork.has(book.workId)
          ? recommendationEditionByWork.get(book.workId) ?? null
          : catalogEditionByWork.get(book.workId) ?? null,
        score: book.score,
        because: book.because,
      })),
  );
  const replaced = await db.rpc("replace_genre_recommendations", {
    p_user_id: userId,
    p_rows: replacements,
  });
  if (replaced.error) fail(replaced.error);
}

async function updateGenreRecommendationsSafely(
  dependencies: RecommendationDependencies,
  input: Omit<GenreRecommendationInput, "fetchHardcover">,
): Promise<void> {
  try {
    await dependencies.genreRecommendations({
      ...input,
      fetchHardcover: dependencies.fetchHardcover,
    });
  } catch (error) {
    console.warn("Genre recommendations failed:", error);
  }
}

async function linkedEdition(
  db: DbClient,
  workId: string,
): Promise<EditionRow | null> {
  const { data, error } = await db.from("editions").select("*").eq(
    "work_id",
    workId,
  )
    .gt("simania_id", 0)
    .order("simania_id", { ascending: true }).limit(1).maybeSingle();
  if (error) fail(error);
  return data as EditionRow | null;
}

type Prepared = {
  work: WorkRow;
  edition: EditionRow | null;
  hint: HebrewHint | null;
  replacement: RecommendationReplacement;
};

async function prepareCandidate(
  db: DbClient,
  work: WorkRow,
  score: number,
  because: number[],
  tags: string[],
  dependencies: RecommendationDependencies,
): Promise<Prepared> {
  let edition: EditionRow | null = null;
  let hint: HebrewHint | null = null;
  try {
    edition = await linkedEdition(db, work.id);
    if (!edition) {
      hint = await dependencies.hebrewHint({
        id: work.hardcover_id!,
        title: work.original_title,
        cached_contributors: work.original_authors.map((name) => ({
          author: { name },
        })),
        cached_similar_book_ids: work.similar_ids,
        cached_tags: work.tags,
        image: { url: work.hardcover_cover_url },
      });
    }
  } catch (error) {
    console.warn(`Could not localize ${work.original_title}:`, error);
    edition = null;
    hint = null;
  }
  return {
    work,
    edition,
    hint,
    replacement: {
      work_id: work.id,
      simania_id: edition?.simania_id ?? null,
      score,
      because,
      shared_tags: tags,
    },
  };
}

export async function handleRecommendations(
  request: Request,
  overrides: Partial<RecommendationDependencies> = {},
): Promise<Response> {
  const preflight = options(request);
  if (preflight) return preflight;
  const dependencies = { ...defaults, ...overrides };
  try {
    const userId = await dependencies.authenticate(request);
    const input = await body<unknown>(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new HttpError(400, "The request body must be a JSON object.");
    }
    const userDb = dependencies.userDatabase(request);
    const serviceDb = dependencies.serviceDatabase();
    await selfHealShelvedEditions(
      userDb,
      serviceDb,
      userId,
      dependencies.ensureResolved,
    );
    const [library, dismissed] = await Promise.all([
      loadLibrary(userDb, userId),
      loadDismissed(userDb, userId),
    ]);
    const seeds = selectSeeds(library);
    if (!seeds.length) {
      const replaced = await serviceDb.rpc("replace_recommendations", {
        p_user_id: userId,
        p_rows: [],
      });
      if (replaced.error) fail(replaced.error);
      await updateGenreRecommendationsSafely(dependencies, {
        db: serviceDb,
        userId,
        library,
        seeds,
        dismissed,
        ordinaryRecommendations: [],
      });
      return json({ recommendations: [] });
    }

    const scored = scoreCandidates(seeds);
    const candidateIds = scored.map((item) => item.hardcover_id);
    const known = await loadWorks(serviceDb, candidateIds);
    const allWorks = await loadAndStoreMissingWorks(
      serviceDb,
      candidateIds,
      known,
      dependencies.fetchHardcover,
    );
    const byHardcover = new Map(
      allWorks.filter((work) => work.hardcover_id !== null).map((
        work,
      ) => [work.hardcover_id!, work]),
    );
    const shelved = new Set(
      library.flatMap((item) => item.work ? [item.work.id] : []),
    );
    const candidates = excludeCandidates(
      scored,
      byHardcover,
      shelved,
      dismissed,
    )
      .filter((candidate) => byHardcover.has(candidate.hardcover_id)).slice(
        0,
        40,
      );
    const seedById = new Map(seeds.map((seed) => [seed.simania_id, seed]));
    const prepared: Prepared[] = [];
    for (
      let index = 0;
      index < candidates.length && prepared.length < 20;
      index += 5
    ) {
      const batch = candidates.slice(
        index,
        Math.min(index + 5, index + 20 - prepared.length),
      );
      prepared.push(
        ...await Promise.all(batch.map((candidate) => {
          const work = byHardcover.get(candidate.hardcover_id)!;
          const contributingTags = candidate.because.flatMap((id) => {
            const seed = seedById.get(id);
            return seed?.work ? [seed.work.tags] : [];
          });
          return prepareCandidate(
            serviceDb,
            work,
            candidate.score,
            candidate.because,
            sharedTags(work.tags, contributingTags),
            dependencies,
          );
        })),
      );
    }

    const replacement = await serviceDb.rpc("replace_recommendations", {
      p_user_id: userId,
      p_rows: prepared.map((item) => item.replacement),
    });
    if (replacement.error) fail(replacement.error);
    const ordinaryRecommendations =
      (replacement.data ?? []) as RecommendationRow[];
    await updateGenreRecommendationsSafely(dependencies, {
      db: serviceDb,
      userId,
      library,
      seeds,
      dismissed,
      ordinaryRecommendations,
    });
    const preparedByWork = new Map(
      prepared.map((item) => [item.work.id, item]),
    );
    const titleBySeed = new Map(
      seeds.map((seed) => [seed.simania_id, seed.title]),
    );
    const authorCache = new Map<string, string | null>();
    const authorLookups = new Map<string, Promise<string | null>>();
    const resolveHebrewAuthor = dependencies.hebrewAuthor ??
      ((
        db,
        author,
        cache,
      ) => hebrewAuthorFor(db, author, dependencies, cache, authorLookups));
    const cards: RecommendationCard[] = await Promise.all(
      ordinaryRecommendations.flatMap((row) => {
        const item = preparedByWork.get(row.work_id);
        if (!item) return [];
        const edition = item.edition;
        const englishAuthor = item.work.original_authors[0] ?? "";
        return [{
          row,
          item,
          edition,
          englishAuthor,
        }];
      }).map(async ({ row, item, edition, englishAuthor }) => {
        const hebrew_author = row.simania_id === null
          ? await resolveHebrewAuthor(serviceDb, englishAuthor, authorCache)
          : null;
        return {
          work_id: row.work_id,
          hardcover_id: item.work.hardcover_id!,
          simania_id: row.simania_id,
          title: edition?.title ?? item.work.original_title,
          author: edition?.author ??
            (item.work.original_authors.length
              ? item.work.original_authors.join(", ")
              : null),
          cover_url: edition?.cover_url ?? item.work.hardcover_cover_url,
          score: row.score,
          because: row.because,
          because_titles: row.because.map((id) => titleBySeed.get(id)).filter((
            title,
          ): title is string => title !== undefined),
          shared_tags: row.shared_tags,
          dismissed: row.dismissed,
          generated_at: row.generated_at,
          english_only: row.simania_id === null,
          can_add: true,
          hebrew_hint: row.simania_id === null ? item.hint : null,
          hebrew_author,
        };
      }),
    );
    return json({ recommendations: cards });
  } catch (error) {
    return errorResponse(error);
  }
}

if (import.meta.main) Deno.serve((request) => handleRecommendations(request));
