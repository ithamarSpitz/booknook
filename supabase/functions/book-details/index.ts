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
import type {
  BookDetailsRequest,
  BookDetailsResponse,
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

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      const userId = await deps.requireUser(req);
      const input = await body<Partial<BookDetailsRequest>>(req);
      if (
        !Number.isSafeInteger(input.simania_id) ||
        Number(input.simania_id) === 0
      ) {
        throw new HttpError(400, "A valid Simania ID is required.");
      }
      const catalogDb = deps.serviceClient();
      let edition;
      if (input.simania_id! < 0) {
        edition = await deps.ensureEnglishEdition(
          catalogDb,
          -input.simania_id!,
        );
      } else {
        edition = await deps.ensureEdition(
          catalogDb,
          input.simania_id!,
          suppliedProviders(suppliedSimania(input.simania)),
        );
        // Pending after a provider failure in add-book: opening the card retries it.
        if (edition.resolve_status === "pending") {
          edition = await deps.ensureResolved(catalogDb, edition);
        }
      }
      const response: BookDetailsResponse = {
        book: await bookCard(deps.userClient(req), userId, edition),
      };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
