import { hebrewCandidates } from "../_shared/hebrew-candidates.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
import { hardcoverEnglishBooks as hardcoverBooks } from "../_shared/hardcover.ts";
import type {
  HebrewCandidatesRequest,
  HebrewCandidatesResponse,
} from "../_shared/types.ts";
import {
  body,
  errorResponse,
  HttpError,
  json,
  options,
} from "../_shared/utils.ts";

type DbClient = ReturnType<typeof serviceClient>;
type CandidateWork = Parameters<typeof hebrewCandidates>[0];
type FunctionDeps = {
  requireUser: typeof requireUser;
  userClient: (request: Request) => DbClient;
  serviceClient: () => DbClient;
  hardcoverBooks: typeof hardcoverBooks;
  candidates: (work: CandidateWork) => ReturnType<typeof hebrewCandidates>;
};

const defaults: FunctionDeps = {
  requireUser,
  userClient,
  serviceClient,
  hardcoverBooks,
  candidates: hebrewCandidates,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbFailure(error: { message?: string }): never {
  throw new Error(error.message ?? "Database operation failed.");
}

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (request: Request): Promise<Response> => {
    const preflight = options(request);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(request);
      const input = await body<Partial<HebrewCandidatesRequest>>(request);
      if (
        !input || typeof input !== "object" ||
        typeof input.work_id !== "string" ||
        !UUID_PATTERN.test(input.work_id)
      ) {
        throw new HttpError(400, "A valid work_id is required.");
      }

      const callerDb = deps.userClient(request);
      const recommendation = await callerDb.from("recommendations")
        .select("work_id")
        .eq("user_id", userId)
        .eq("work_id", input.work_id)
        .eq("dismissed", false)
        .maybeSingle();
      if (recommendation.error) dbFailure(recommendation.error);
      let genre = null;
      if (!recommendation.data) {
        const result = await callerDb.from("genre_recommendations")
          .select("work_id")
          .eq("user_id", userId)
          .eq("work_id", input.work_id)
          .maybeSingle();
        if (result.error) dbFailure(result.error);
        genre = result.data;
      }
      if (!recommendation.data && !genre) {
        throw new HttpError(404, "Recommendation not found.");
      }

      const workResult = await deps.serviceClient().from("works")
        .select("id, hardcover_id, original_title, original_authors")
        .eq("id", input.work_id)
        .maybeSingle();
      if (workResult.error) dbFailure(workResult.error);
      if (!workResult.data) throw new HttpError(404, "Work not found.");
      const work = workResult.data as {
        hardcover_id: number | null;
        original_title: string;
        original_authors: string[];
      };

      let description: string | null = null;
      if (typeof work.hardcover_id === "number") {
        try {
          const books = await deps.hardcoverBooks([work.hardcover_id]);
          const value = (books[0] as { description?: unknown } | undefined)
            ?.description;
          description = typeof value === "string" ? value : null;
        } catch {
          // Description is optional; a Hardcover failure does not fail fallback.
        }
      }
      const result = await deps.candidates({
        title: work.original_title,
        author: work.original_authors[0] ?? "",
        description,
      });
      const response: HebrewCandidatesResponse = {
        work_id: input.work_id,
        ...result,
      };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
