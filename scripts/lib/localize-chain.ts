import { wikidataHebrewAuthor } from "../../supabase/functions/_shared/bridges.ts";
import {
  authors,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import type { AuthorCandidate } from "../../supabase/functions/_shared/types.ts";
import { ensureResolved } from "../../supabase/functions/_shared/catalog.ts";
import {
  defaultHebrewHint,
  hebrewAuthorFor,
} from "../../supabase/functions/recommendations/index.ts";
import { matchCandidates } from "../../supabase/functions/match-by-author/index.ts";
import { matchHebrewBook, searchByAuthor } from "../../public/js/simania.js";
import { FUNCTIONS } from "../../public/js/contract.js";
import { verifyTitleMatch } from "../../public/js/recs.js";
import type { FakeDb } from "../../tests/functions/helpers/fake-db.ts";

const authorDeps = { wikidataHebrewAuthor };
const matchDeps = {
  ensureResolved,
  now: () => new Date(),
};

export interface LocalizationResult {
  simaniaId: number | null;
  title: string | null;
  path: "title" | "author" | null;
}

export async function localizeChain(
  db: FakeDb,
  hardcoverId: number,
  book: HardcoverBook,
): Promise<LocalizationResult> {
  let simaniaId: number | null = null;
  let title: string | null = null;
  let path: "title" | "author" | null = null;

  const englishAuthor = authors(book)[0] ?? "";
  const hebrewAuthor = await hebrewAuthorFor(
    db as never,
    englishAuthor,
    authorDeps,
    new Map(),
  );

  const hint = await defaultHebrewHint(book);
  const workId = `loc-work-${hardcoverId}`;
  const titleMatchDeps = {
    callFunction: async (name: string, body: Record<string, unknown>) => {
      if (name !== FUNCTIONS.MATCH_BY_AUTHOR) {
        throw new Error(`unexpected function ${name}`);
      }
      return await matchCandidates(
        db,
        hardcoverId,
        body.candidates as AuthorCandidate[],
        matchDeps,
      );
    },
  };

  if (hint?.title) {
    path = "title";
    const matched = await matchHebrewBook(hint.title, hint.author ?? "");
    if (matched) {
      const verified = await verifyTitleMatch(
        {
          work_id: workId,
          hebrew_hint: hint,
          hebrew_author: hebrewAuthor,
        },
        matched,
        titleMatchDeps,
      );
      if (verified) {
        simaniaId = verified.simania_id;
        title = matched.title;
      }
    }
  }

  if (simaniaId == null) {
    if (hebrewAuthor) {
      path = "author";
      const candidates = await searchByAuthor(
        hebrewAuthor,
      ) as AuthorCandidate[];
      if (candidates.length) {
        const matched = await matchCandidates(
          db,
          hardcoverId,
          candidates,
          matchDeps,
        );
        if (matched.simania_id != null) {
          simaniaId = matched.simania_id;
          title = candidates.find((candidate) =>
            candidate.simania_id === matched.simania_id
          )?.title ?? null;
        }
      }
    }
  }

  return { simaniaId, title, path };
}
