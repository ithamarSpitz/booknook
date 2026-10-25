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
      const input = await body<Partial<LinkEditionRequest>>(req);
      if (
        typeof input.work_id !== "string" || !input.work_id.trim() ||
        !Number.isSafeInteger(input.simania_id) ||
        Number(input.simania_id) <= 0 ||
        (input.source !== "wikidata" && input.source !== "nli")
      ) {
        throw new HttpError(
          400,
          "work_id, simania_id and source (wikidata or nli) are required.",
        );
      }
      const supplied = suppliedSimania(input.simania);
      if (!supplied) throw new HttpError(400, "simania is required.");

      // Only a work the caller was recommended can be linked.
      const own = await deps.userClient(req).from("recommendations")
        .select("work_id").eq("user_id", userId).eq("work_id", input.work_id)
        .eq("dismissed", false).maybeSingle();
      if (own.error) dbFailure(own.error);
      if (!own.data) throw new HttpError(404, "Recommendation not found.");

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

      const updated = await db.from("recommendations")
        .update({ simania_id: simaniaId })
        .eq("user_id", userId).eq("work_id", input.work_id).select("work_id");
      if (updated.error) dbFailure(updated.error);
      if (!updated.data?.length) {
        throw new HttpError(404, "Recommendation not found.");
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
