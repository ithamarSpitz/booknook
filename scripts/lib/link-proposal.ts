import { wikidataEnglishAuthor } from "../../supabase/functions/_shared/bridges.ts";
import {
  authors,
  type HardcoverBook,
  hardcoverBooks,
  searchHardcoverBooks,
} from "../../supabase/functions/_shared/hardcover.ts";
import { similarity } from "../../supabase/functions/_shared/utils.ts";
import { nameSoundScore } from "./names.ts";
import { fetchSimaniaPage, pageOriginalTitle } from "./simania-page.ts";

export interface ProposalDeps {
  fetchPage(id: number): Promise<string>;
  wikidataEnglishAuthor(name: string): Promise<string | null>;
  searchIds(title: string): Promise<number[]>;
  books(ids: number[]): Promise<HardcoverBook[]>;
}

export interface LinkProposal {
  simania_id: number;
  original_title: string | null;
  english_author: string | null;
  book: HardcoverBook | null;
  reason:
    | "ok"
    | "no_original_title"
    | "no_author_match"
    | "ambiguous"
    | "provider_error";
}

const defaultDeps: ProposalDeps = {
  fetchPage: fetchSimaniaPage,
  wikidataEnglishAuthor,
  searchIds: searchHardcoverBooks,
  books: hardcoverBooks,
};

export async function proposeLink(
  edition: { simania_id: number; title: string; author: string | null },
  deps: Partial<ProposalDeps> = {},
): Promise<LinkProposal> {
  const providers = { ...defaultDeps, ...deps };
  let originalTitle: string | null = null;
  let englishAuthor: string | null = null;

  try {
    originalTitle = pageOriginalTitle(
      await providers.fetchPage(edition.simania_id),
    );
    if (originalTitle === null) {
      return proposal(
        edition.simania_id,
        null,
        null,
        null,
        "no_original_title",
      );
    }

    englishAuthor = await providers.wikidataEnglishAuthor(edition.author ?? "");
    const searchedIds = (await providers.searchIds(originalTitle)).slice(0, 8);
    const searchedIdSet = new Set(searchedIds);
    const candidates = (await providers.books(searchedIds))
      .filter((book) => searchedIdSet.has(book.id))
      .map((book) => ({
        book,
        titleScore: similarity(originalTitle, book.title),
      }))
      .filter(({ titleScore }) => titleScore >= 0.9);

    if (englishAuthor !== null) {
      const matching = candidates
        .filter(({ book }) =>
          authors(book).some((name) => similarity(englishAuthor, name) > 0.45)
        )
        .sort((left, right) =>
          right.titleScore - left.titleScore ||
          (right.book.users_read_count ?? 0) -
            (left.book.users_read_count ?? 0) ||
          left.book.id - right.book.id
        );
      const book = matching[0]?.book ?? null;
      return proposal(
        edition.simania_id,
        originalTitle,
        englishAuthor,
        book,
        book === null ? "no_author_match" : "ok",
      );
    }

    const matching = candidates.filter(({ book }) =>
      nameSoundScore(edition.author ?? "", authors(book)) >= 0.5
    );
    if (matching.length === 0) {
      return proposal(
        edition.simania_id,
        originalTitle,
        null,
        null,
        "no_author_match",
      );
    }
    if (matching.length > 1) {
      return proposal(
        edition.simania_id,
        originalTitle,
        null,
        null,
        "ambiguous",
      );
    }
    return proposal(
      edition.simania_id,
      originalTitle,
      null,
      matching[0].book,
      "ok",
    );
  } catch {
    return proposal(
      edition.simania_id,
      originalTitle,
      englishAuthor,
      null,
      "provider_error",
    );
  }
}

function proposal(
  simania_id: number,
  original_title: string | null,
  english_author: string | null,
  book: HardcoverBook | null,
  reason: LinkProposal["reason"],
): LinkProposal {
  return { simania_id, original_title, english_author, book, reason };
}
