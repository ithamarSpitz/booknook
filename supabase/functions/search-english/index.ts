import { requireUser } from "../_shared/db.ts";
import { searchEnglish as defaultSearchEnglish } from "../_shared/english.ts";
import type {
  SearchEnglishRequest,
  SearchEnglishResponse,
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
  searchEnglish: typeof defaultSearchEnglish;
};

const defaults: FunctionDeps = {
  requireUser,
  searchEnglish: defaultSearchEnglish,
};

export function createHandler(overrides: Partial<FunctionDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (req: Request): Promise<Response> => {
    const preflight = options(req);
    if (preflight) return preflight;
    try {
      await deps.requireUser(req);
      const input = await body<Partial<SearchEnglishRequest> | null>(req);
      if (typeof input?.query !== "string") {
        throw new HttpError(400, "query must be a string.");
      }

      let books: SearchEnglishResponse["books"];
      try {
        books = await deps.searchEnglish(input.query);
      } catch {
        throw new HttpError(502, "Hardcover request failed.");
      }
      return json({ books } satisfies SearchEnglishResponse);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
