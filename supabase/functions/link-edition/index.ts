import {
  type CatalogDb,
  ensureEdition,
  suppliedProviders,
  suppliedSimania,
} from "../_shared/catalog.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
import type {
  EditionRow,
  LinkEditionRequest,
  LinkEditionResponse,
} from "../_shared/types.ts";
import {
  body,
  errorResponse,
  HttpError,
  json,
  options,
} from "../_shared/utils.ts";

type FunctionDeps = {
  requireUser: typeof requireUser;
  serviceClient: () => CatalogDb;
  userClient: (req: Request) => CatalogDb;
  ensureEdition: typeof ensureEdition;
};

type LinkEditionInput = Omit<LinkEditionRequest, "source"> & {
  source: LinkEditionRequest["source"] | "nli_author";
};

const defaults: FunctionDeps = {
  requireUser,
  serviceClient,
  userClient,
  ensureEdition,
};

function dbFailure(error: { message?: string }): never {
  throw new Error(error.message ?? "Database operation failed.");
}

// The browser matched an English-only recommendation to a Simania edition
// (Simania is unreachable from Edge Functions). Store that edition, link it to
// the recommended work, and localize the caller's recommendation row.
export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(req);
      const input = await body<Partial<LinkEditionInput>>(req);
      if (
        typeof input.work_id !== "string" || !input.work_id.trim() ||
        !Number.isSafeInteger(input.simania_id) ||
        Number(input.simania_id) <= 0 ||
        (input.source !== "wikidata" && input.source !== "nli" &&
          input.source !== "nli_author")
      ) {
        throw new HttpError(
          400,
          "work_id, simania_id and source (wikidata, nli or nli_author) are required.",
        );
      }
      const supplied = suppliedSimania(input.simania);
      if (!supplied) throw new HttpError(400, "simania is required.");

      // Only a work the caller was recommended can be linked.
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
      const simaniaId = input.simania_id!;
      const edition = await deps.ensureEdition(
        db,
        simaniaId,
        suppliedProviders(supplied),
      );
      if (edition.work_id && edition.work_id !== input.work_id) {
        throw new HttpError(409, "Edition belongs to another work.");
      }
      if (!edition.work_id) {
        // Claim only an unlinked row. PostgreSQL rechecks this predicate after
        // waiting for a concurrent writer, including one in another request.
        const claim = await db.from("editions").update({
          work_id: input.work_id,
          resolve_status: input.source,
          resolved_at: new Date().toISOString(),
        }).eq("simania_id", simaniaId).is("work_id", null);
        if (claim.error) dbFailure(claim.error);
      }
      const stored = await db.from("editions").select("*")
        .eq("simania_id", simaniaId).single();
      if (stored.error) dbFailure(stored.error);
      const linked = stored.data as EditionRow;
      if (linked.work_id !== input.work_id) {
        throw new HttpError(409, "Edition belongs to another work.");
      }

      const onThisEdition = await callerDb.from("shelf_books")
        .select("simania_id").eq("user_id", userId).eq("simania_id", simaniaId)
        .maybeSingle();
      if (onThisEdition.error) dbFailure(onThisEdition.error);
      let onShelf = !!onThisEdition.data;
      if (!onShelf) {
        const siblings = await callerDb.from("editions").select("simania_id")
          .eq("work_id", input.work_id);
        if (siblings.error) dbFailure(siblings.error);
        const siblingIds = (siblings.data ?? [])
          .map((row: { simania_id: number }) => row.simania_id)
          .filter((id: number) => id !== simaniaId);
        if (siblingIds.length > 0) {
          const shelved = await callerDb.from("shelf_books").select(
            "simania_id",
          )
            .eq("user_id", userId).in("simania_id", siblingIds);
          if (shelved.error) dbFailure(shelved.error);
          onShelf = (shelved.data?.length ?? 0) > 0;
        }
      }
      if (onShelf) {
        const removedRecommendation = await db.from("recommendations").delete()
          .eq("user_id", userId).eq("work_id", input.work_id)
          .eq("dismissed", false);
        if (removedRecommendation.error) dbFailure(removedRecommendation.error);
        const removedGenreRecommendation = await db.from(
          "genre_recommendations",
        ).delete().eq("user_id", userId).eq("work_id", input.work_id);
        if (removedGenreRecommendation.error) {
          dbFailure(removedGenreRecommendation.error);
        }
        throw new HttpError(409, "Already on your shelves.");
      }

      const updatedRecommendation = await db.from("recommendations")
        .update({ simania_id: simaniaId })
        .eq("user_id", userId).eq("work_id", input.work_id).select("work_id");
      if (updatedRecommendation.error) dbFailure(updatedRecommendation.error);
      const updatedGenreRecommendation = await db.from(
        "genre_recommendations",
      ).update({ simania_id: simaniaId })
        .eq("user_id", userId).eq("work_id", input.work_id).select("work_id");
      if (updatedGenreRecommendation.error) {
        dbFailure(updatedGenreRecommendation.error);
      }

      const response: LinkEditionResponse = {
        work_id: input.work_id,
        simania_id: simaniaId,
        title: linked.title,
        author: linked.author,
        cover_url: linked.cover_url,
      };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
