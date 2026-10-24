import { body, errorResponse, HttpError, json, options } from "../_shared/utils.ts";
import { SimaniaBook } from "../_shared/simania.ts";
import { resolveBook } from "../_shared/bridges.ts";

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;
  try {
    const input = await body<{ book?: SimaniaBook }>(req);
    if (!input.book?.title) throw new HttpError(400, "A selected book is required.");
    const match = await resolveBook(input.book);
    if (!match) throw new HttpError(404, "The selected edition could not be connected automatically.");
    return json(match);
  } catch (error) {
    return errorResponse(error);
  }
});

