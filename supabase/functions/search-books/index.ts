import {
  body,
  errorResponse,
  HttpError,
  json,
  options,
} from "../_shared/utils.ts";
import { searchBooks } from "../_shared/simania.ts";
import { requireUser } from "../_shared/db.ts";
import type {
  SearchBooksRequest,
  SearchBooksResponse,
} from "../_shared/types.ts";

type FunctionDeps = {
  requireUser: typeof requireUser;
  searchBooks: typeof searchBooks;
};
const defaults: FunctionDeps = { requireUser, searchBooks };

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      await deps.requireUser(req);
      const input = await body<Partial<SearchBooksRequest>>(req);
      if (typeof input.query !== "string") {
        throw new HttpError(400, "A query is required.");
      }
      const query = input.query.trim();
      const response: SearchBooksResponse = {
        books: query.length < 2
          ? []
          : (await deps.searchBooks(query, 8)).slice(0, 8),
      };
      return json(response);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
