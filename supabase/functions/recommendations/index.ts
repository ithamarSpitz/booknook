import { body, errorResponse, HttpError, json, options } from "../_shared/utils.ts";
import { authors, hardcoverBooks, HardcoverBook } from "../_shared/hardcover.ts";
import { localizeRecommendation } from "../_shared/bridges.ts";
import { SimaniaBook } from "../_shared/simania.ts";

type Seed = { simaniaTitle: string; hardcover: HardcoverBook };
type Candidate = { book: HardcoverBook; score: number; because: string[] };

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;
  try {
    const input = await body<{ seeds?: Seed[] }>(req);
    const seeds = (input.seeds ?? []).filter((seed) => seed?.hardcover?.id).slice(0, 5);
    if (!seeds.length) throw new HttpError(400, "At least one resolved book is required.");

    const chosen = new Set(seeds.map((seed) => seed.hardcover.id));
    const scores = new Map<number, { score: number; because: string[] }>();
    for (const seed of seeds) {
      for (const [rank, id] of (seed.hardcover.cached_similar_book_ids ?? []).slice(0, 40).entries()) {
        if (chosen.has(id)) continue;
        const current = scores.get(id) ?? { score: 0, because: [] };
        current.score += 1 - rank / 40;
        current.because.push(seed.simaniaTitle);
        scores.set(id, current);
      }
    }
    const ids = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 60).map(([id]) => id);
    if (!ids.length) return json({ recommendations: [] });

    const books: HardcoverBook[] = [];
    for (let index = 0; index < ids.length; index += 50) books.push(...await hardcoverBooks(ids.slice(index, index + 50)));
    const byId = new Map(books.map((book) => [book.id, book]));
    const ranked: Candidate[] = [...scores.entries()]
      .map(([id, meta]) => ({ book: byId.get(id)!, ...meta }))
      .filter((candidate) => candidate.book)
      .sort((a, b) => b.score - a.score)
      .slice(0, 35);

    const results: Array<{ simania: SimaniaBook; hardcover: HardcoverBook; score: number; because: string[] }> = [];
    for (let index = 0; index < ranked.length && results.length < 10; index += 5) {
      const localized = await Promise.all(ranked.slice(index, index + 5).map(async (candidate) => {
        try {
          return { candidate, simania: await localizeRecommendation(candidate.book) };
        } catch (error) {
          console.warn(`Could not localize ${candidate.book.title}:`, error);
          return { candidate, simania: null };
        }
      }));
      for (const item of localized) {
        if (item.simania) results.push({
          simania: item.simania,
          hardcover: { ...item.candidate.book, cached_contributors: item.candidate.book.cached_contributors },
          score: item.candidate.score,
          because: [...new Set(item.candidate.because)],
        });
      }
    }

    return json({
      recommendations: results.slice(0, 10).map((item) => ({
        ...item,
        authors: authors(item.hardcover),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

