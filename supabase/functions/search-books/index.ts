import { body, errorResponse, HttpError, json, options } from "../_shared/utils.ts";
import { searchBooks } from "../_shared/simania.ts";

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;
  try {
    const input = await body<{ query?: string }>(req);
    const query = input.query?.trim() ?? "";
    if (query.length < 2) throw new HttpError(400, "Enter at least two characters.");
    return json({ books: await searchBooks(query, 8) });
  } catch (error) {
    return errorResponse(error);
  }
});

