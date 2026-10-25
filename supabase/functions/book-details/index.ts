import { bookCard, type CatalogDb, ensureEdition } from "../_shared/catalog.ts";
import { requireUser, serviceClient, userClient } from "../_shared/db.ts";
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
};

const defaults: FunctionDeps = {
  requireUser,
  serviceClient,
  userClient,
  ensureEdition,
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
        !Number.isSafeInteger(input.simania_id) || Number(input.simania_id) <= 0
      ) {
        throw new HttpError(400, "A valid Simania ID is required.");
      }
      const edition = await deps.ensureEdition(
        deps.serviceClient(),
        input.simania_id!,
      );
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
