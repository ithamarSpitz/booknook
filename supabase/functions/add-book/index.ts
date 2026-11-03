import {
  bookCard,
  type CatalogDb,
  ensureEdition,
  ensureResolved,
  suppliedProviders,
  suppliedSimania,
} from "../_shared/catalog.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
import { ensureEnglishEdition } from "../_shared/english.ts";
import type { AddBookRequest, AddBookResponse } from "../_shared/types.ts";
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
  ensureEnglishEdition: typeof ensureEnglishEdition;
  ensureResolved: typeof ensureResolved;
};

const defaults: FunctionDeps = {
  requireUser,
  serviceClient,
  userClient,
  ensureEdition,
  ensureEnglishEdition,
  ensureResolved,
};

function duplicate(
  error: { code?: string; message?: string; details?: string },
): boolean {
  if (error.code !== "23505") return false;
  const diagnostic = `${error.message ?? ""} ${error.details ?? ""}`;
  return diagnostic.includes("shelf_books_pkey") ||
    diagnostic.includes("shelf_books_user_work_key");
}

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(req);
      const input = await body<Partial<AddBookRequest>>(req);
      const hasSimaniaId = input.simania_id !== undefined;
      const hasHardcoverId = input.hardcover_id !== undefined;
      if (
        hasSimaniaId === hasHardcoverId ||
        (hasSimaniaId &&
          (!Number.isSafeInteger(input.simania_id) ||
            Number(input.simania_id) <= 0)) ||
        (hasHardcoverId &&
          (!Number.isSafeInteger(input.hardcover_id) ||
            Number(input.hardcover_id) <= 0)) ||
        typeof input.shelf_id !== "string" || !input.shelf_id.trim()
      ) {
        throw new HttpError(
          400,
          "Exactly one valid book ID and a shelf ID are required.",
        );
      }

      const catalogDb = deps.serviceClient();
      const callerDb = deps.userClient(req);
      const shelfResult = await callerDb.from("shelves").select("id")
        .eq("id", input.shelf_id).eq("user_id", userId).maybeSingle();
      if (shelfResult.error) throw new Error(shelfResult.error.message);
      if (!shelfResult.data) throw new HttpError(404, "Shelf not found.");

      let edition;
      if (hasHardcoverId) {
        edition = await deps.ensureEnglishEdition(
          catalogDb,
          input.hardcover_id!,
        );
      } else {
        edition = await deps.ensureEdition(
          catalogDb,
          input.simania_id!,
          suppliedProviders(suppliedSimania(input.simania)),
        );
        try {
          edition = await deps.ensureResolved(catalogDb, edition);
        } catch (error) {
          console.error(
            "Book resolution failed; shelving unresolved edition.",
            error,
          );
        }
      }

      const insertResult = await callerDb.from("shelf_books").insert({
        user_id: userId,
        simania_id: edition.simania_id,
        shelf_id: input.shelf_id,
      });
      if (insertResult.error) {
        if (duplicate(insertResult.error)) {
          throw new HttpError(409, "Book is already on a shelf.");
        }
        if (["23503", "P0002"].includes(insertResult.error.code ?? "")) {
          throw new HttpError(404, "Book or shelf not found.");
        }
        throw new Error(insertResult.error.message);
      }

      const response: AddBookResponse = {
        book: await bookCard(callerDb, userId, edition),
        resolve_status: edition.resolve_status,
      };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
