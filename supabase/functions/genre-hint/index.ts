import { wikidataHebrewAuthor } from "../_shared/bridges.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
import type { HardcoverBook } from "../_shared/hardcover.ts";
import type {
  GenreHintRequest,
  GenreHintResponse,
  HebrewHint,
  WorkRow,
} from "../_shared/types.ts";
import {
  body,
  errorResponse,
  HttpError,
  json,
  options,
} from "../_shared/utils.ts";
import {
  defaultHebrewHint,
  hebrewAuthorFor,
} from "../recommendations/index.ts";

type DbClient = ReturnType<typeof serviceClient>;

type FunctionDeps = {
  requireUser: typeof requireUser;
  userClient: (request: Request) => DbClient;
  serviceClient: () => DbClient;
  hebrewHint: (book: HardcoverBook) => Promise<HebrewHint | null>;
  hebrewAuthor: (
    db: DbClient,
    englishAuthor: string,
  ) => Promise<string | null>;
};

const defaults: FunctionDeps = {
  requireUser,
  userClient,
  serviceClient,
  hebrewHint: defaultHebrewHint,
  hebrewAuthor: (db, englishAuthor) =>
    hebrewAuthorFor(
      db,
      englishAuthor,
      { wikidataHebrewAuthor },
      new Map(),
    ),
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbFailure(error: { message?: string }): never {
  throw new Error(error.message ?? "Database operation failed.");
}

function hardcoverBook(work: WorkRow): HardcoverBook {
  return {
    id: work.hardcover_id!,
    title: work.original_title,
    cached_contributors: work.original_authors.map((name) => ({
      author: { name },
    })),
    cached_similar_book_ids: work.similar_ids,
    cached_tags: work.tags,
    image: { url: work.hardcover_cover_url },
  };
}

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (request: Request): Promise<Response> => {
    const preflight = options(request);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(request);
      const input = await body<Partial<GenreHintRequest>>(request);
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.work_id !== "string" ||
        !UUID_PATTERN.test(input.work_id)
      ) {
        throw new HttpError(400, "A valid work_id is required.");
      }

      const callerDb = deps.userClient(request);
      const genreRow = await callerDb.from("genre_recommendations")
        .select("work_id")
        .eq("user_id", userId)
        .eq("work_id", input.work_id)
        .maybeSingle();
      if (genreRow.error) dbFailure(genreRow.error);
      if (!genreRow.data) {
        throw new HttpError(404, "Genre recommendation not found.");
      }

      const db = deps.serviceClient();
      const workResult = await db.from("works").select(
        "id, hardcover_id, original_title, original_authors, similar_ids, tags, hardcover_cover_url, refreshed_at",
      ).eq("id", input.work_id).maybeSingle();
      if (workResult.error) dbFailure(workResult.error);
      if (!workResult.data) {
        throw new HttpError(404, "Work not found.");
      }
      const work = workResult.data as WorkRow;
      const englishAuthor = work.original_authors[0] ?? "";
      const [hebrewHint, hebrewAuthor] = await Promise.all([
        deps.hebrewHint(hardcoverBook(work)).catch(() => null),
        deps.hebrewAuthor(db, englishAuthor).catch(() => null),
      ]);
      const response: GenreHintResponse = {
        work_id: input.work_id,
        hebrew_hint: hebrewHint,
        hebrew_author: hebrewAuthor,
      };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
