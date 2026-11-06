import {
  type CatalogDb,
  ensureResolved as defaultEnsureResolved,
} from "../_shared/catalog.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
import type {
  AuthorCandidate,
  EditionRow,
  MatchByAuthorRequest,
  MatchByAuthorResponse,
  ResolveStatus,
} from "../_shared/types.ts";
import {
  body,
  errorResponse,
  HttpError,
  json,
  options,
} from "../_shared/utils.ts";

const MATCH_BUDGET_MS = 25_000;

type FunctionDeps = {
  requireUser: typeof requireUser;
  userClient: (req: Request) => CatalogDb;
  serviceClient: () => CatalogDb;
  ensureResolved: typeof defaultEnsureResolved;
  now: () => Date;
};

const defaults: FunctionDeps = {
  requireUser,
  userClient,
  serviceClient,
  ensureResolved: defaultEnsureResolved,
  now: () => new Date(),
};

function dbFailure(error: { message?: string }): never {
  throw new Error(error.message ?? "Database operation failed.");
}

function validateCandidates(
  candidates: unknown,
): candidates is AuthorCandidate[] {
  if (
    !Array.isArray(candidates) || candidates.length < 1 ||
    candidates.length > 8
  ) {
    return false;
  }
  return candidates.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    const simaniaId = row.simania_id;
    const title = row.title;
    if (!Number.isSafeInteger(simaniaId) || Number(simaniaId) <= 0) {
      return false;
    }
    if (typeof title !== "string" || !title.trim()) return false;
    if (
      "author" in row && row.author !== null &&
      typeof row.author !== "string"
    ) {
      return false;
    }
    return true;
  });
}

function minimalEdition(candidate: AuthorCandidate): Omit<EditionRow, never> {
  return {
    simania_id: candidate.simania_id,
    work_id: null,
    resolve_status: "pending",
    resolved_at: null,
    title: candidate.title,
    author: candidate.author ?? null,
    translator: null,
    publisher: null,
    series: null,
    category: null,
    year: null,
    pages: null,
    description: null,
    cover_url: null,
    simania_rating: null,
    simania_rating_count: null,
    details_at: null,
  };
}

async function readEdition(
  db: CatalogDb,
  simaniaId: number,
): Promise<EditionRow | null> {
  const result = await db.from("editions").select("*").eq(
    "simania_id",
    simaniaId,
  )
    .maybeSingle();
  if (result.error) dbFailure(result.error);
  return (result.data as EditionRow | null) ?? null;
}

async function hardcoverForEdition(
  db: CatalogDb,
  edition: EditionRow,
  resolve: FunctionDeps["ensureResolved"],
): Promise<{ hardcoverId: number | null; edition: EditionRow }> {
  let row = edition;
  if (!row.work_id) {
    row = await resolve(db, row);
  }
  if (!row.work_id) return { hardcoverId: null, edition: row };
  const work = await db.from("works").select("hardcover_id").eq(
    "id",
    row.work_id,
  )
    .single();
  if (work.error) dbFailure(work.error);
  return {
    hardcoverId: (work.data as { hardcover_id: number | null }).hardcover_id,
    edition: row,
  };
}

export type MatchCandidateDeps = Pick<FunctionDeps, "ensureResolved" | "now">;

export async function matchCandidates(
  db: CatalogDb,
  hardcoverId: number,
  candidates: AuthorCandidate[],
  deps: MatchCandidateDeps,
): Promise<MatchByAuthorResponse> {
  const started = deps.now().getTime();
  for (const candidate of candidates) {
    if (deps.now().getTime() - started >= MATCH_BUDGET_MS) break;
    try {
      let edition = await readEdition(db, candidate.simania_id);
      if (!edition) {
        const inserted = await db.from("editions").insert(
          minimalEdition(candidate),
        ).select("*").single();
        if (inserted.error) dbFailure(inserted.error);
        edition = inserted.data as EditionRow;
      }
      const { hardcoverId: candidateHardcover, edition: resolved } =
        await hardcoverForEdition(db, edition, deps.ensureResolved);
      if (
        candidateHardcover !== null && candidateHardcover === hardcoverId
      ) {
        return {
          simania_id: candidate.simania_id,
          resolve_status: resolved.resolve_status as ResolveStatus,
        };
      }
    } catch {
      continue;
    }
  }
  return { simania_id: null, resolve_status: null };
}

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(req);
      const input = await body<Partial<MatchByAuthorRequest>>(req);
      if (
        typeof input.work_id !== "string" || !input.work_id.trim() ||
        !validateCandidates(input.candidates)
      ) {
        throw new HttpError(
          400,
          "work_id and 1–8 candidates with simania_id and title are required.",
        );
      }

      const callerDb = deps.userClient(req);
      const ownRecommendation = await callerDb.from("recommendations")
        .select("work_id").eq("user_id", userId).eq("work_id", input.work_id)
        .eq("dismissed", false).maybeSingle();
      if (ownRecommendation.error) dbFailure(ownRecommendation.error);
      const ownGenreRecommendation = await callerDb.from(
        "genre_recommendations",
      ).select("work_id").eq("user_id", userId).eq("work_id", input.work_id)
        .maybeSingle();
      if (ownGenreRecommendation.error) dbFailure(ownGenreRecommendation.error);
      if (!ownRecommendation.data && !ownGenreRecommendation.data) {
        throw new HttpError(404, "Recommendation not found.");
      }

      const db = deps.serviceClient();
      const work = await db.from("works").select("hardcover_id").eq(
        "id",
        input.work_id!,
      ).single();
      if (work.error) dbFailure(work.error);
      const hardcoverId = (work.data as { hardcover_id: number | null })
        .hardcover_id;
      if (hardcoverId === null || !Number.isInteger(hardcoverId)) {
        return json({ simania_id: null, resolve_status: null });
      }

      const response = await matchCandidates(
        db,
        hardcoverId,
        input.candidates!,
        deps,
      );
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
