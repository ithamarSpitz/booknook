import {
  authors,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import { nameSoundScore } from "../../supabase/functions/_shared/names.ts";
import type { ResolveMatchResult } from "../../supabase/functions/_shared/catalog.ts";
import type { SimaniaBook } from "../../supabase/functions/_shared/simania.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { sameBook } from "../../supabase/functions/link-edition/index.ts";
import {
  normalize,
  similarity,
} from "../../supabase/functions/_shared/utils.ts";

export type RematchWork = {
  id: string;
  hardcover_id: number;
  original_title: string;
  original_authors: string[] | null;
};

export type Candidate = { simania_id: number; via: "forward" | "reverse" };
export type AuthorBook = { simania_id: number; title: string };

export type RematchDeps = {
  hebrewHint(
    work: RematchWork,
  ): Promise<{ title: string; author?: string | null } | null | undefined>;
  matchHebrewBook(title: string, author: string): Promise<number | null>;
  hebrewNames(work: RematchWork): Promise<string[]>;
  searchBooks(
    query: string,
    limit: number,
    offset: number,
  ): Promise<SimaniaBook[]>;
  originals(title: string, hebrewAuthor: string): Promise<string[]>;
  linkedSimaniaIds: Set<number>;
};

const NAME_SCORE = 0.8;
const TITLE_SCORE = 0.72;
const AUTHOR_SCORE = 0.6;
const PAGE = 50;
const MAX_OFFSET = 250;
const MAX_BOOKS = 60;

export function authorVariants(name: string): string[] {
  const collapse = (value: string) => value.trim().replace(/\s+/gu, " ");
  const source = String(name ?? "");
  const variants = [
    collapse(source.replace(/\([^)]*\)/gu, " ")),
    collapse(source.replace(/\S+\s*\(([^)]*)\)/gu, "$1")),
  ];
  return [...new Set(variants.filter(Boolean))];
}

export function authorAgreesWithWork(
  hebrewAuthor: string,
  englishAuthors: string[],
  knownHebrewNames: string[],
): boolean {
  if (!String(hebrewAuthor ?? "").trim()) return false;
  return authorVariants(hebrewAuthor).some((variant) =>
    nameSoundScore(variant, englishAuthors) >= 0.7 ||
    knownHebrewNames.some((name) => similarity(variant, name) >= 0.6)
  );
}

export function authorNamesFromLinks(
  pairs: { he: string; en: string }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pair of pairs) {
    const he = String(pair.he ?? "").trim();
    if (!he || nameSoundScore(he, [pair.en]) < NAME_SCORE) continue;
    const key = normalize(pair.en);
    const names = out.get(key) ?? [];
    if (!names.includes(he)) names.push(he);
    out.set(key, names);
  }
  return out;
}

function strip(title: string): string {
  let value = String(title ?? "").replace(/\([^)]*\)/g, "");
  const colon = value.indexOf(":");
  if (colon >= 0) value = value.slice(0, colon);
  return value.trim().replace(/^the\s+/i, "").trim();
}

export function titleMatches(englishTitle: string, original: string): boolean {
  return similarity(englishTitle, original) >= TITLE_SCORE ||
    similarity(strip(englishTitle), strip(original)) >= TITLE_SCORE;
}

function bookId(book: SimaniaBook): number | null {
  const id = Number(book.id ?? book.bookId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function searchQuery(name: string): string {
  const words = name.trim().split(/\s+/u);
  return words.length <= 1
    ? name.trim()
    : `${words[0]} ${words[words.length - 1]}`;
}

export async function findCandidates(
  work: RematchWork,
  deps: RematchDeps,
): Promise<
  { candidates: Candidate[]; authorBooks: AuthorBook[]; failed: boolean }
> {
  const candidates: Candidate[] = [];
  const authorBooks: AuthorBook[] = [];
  try {
    const hint = await deps.hebrewHint(work);
    if (hint) {
      const id = await deps.matchHebrewBook(hint.title, hint.author ?? "");
      if (id != null && !deps.linkedSimaniaIds.has(id)) {
        candidates.push({ simania_id: id, via: "forward" });
      }
    }
    if (candidates.length > 0) {
      return { candidates, authorBooks, failed: false };
    }

    const names = await deps.hebrewNames(work);
    const seen = new Set<number>();
    let checked = 0;
    for (const name of names) {
      const q = searchQuery(name);
      for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE) {
        const page = await deps.searchBooks(q, PAGE, offset);
        for (const book of page) {
          if (checked >= MAX_BOOKS) break;
          const id = bookId(book);
          if (
            id == null || deps.linkedSimaniaIds.has(id) || seen.has(id) ||
            !/[א-ת]/u.test(book.title ?? "") ||
            similarity(name, book.author) < AUTHOR_SCORE
          ) continue;
          seen.add(id);
          checked++;
          authorBooks.push({ simania_id: id, title: book.title });
          const originals = await deps.originals(book.title, name);
          if (originals.some((o) => titleMatches(work.original_title, o))) {
            candidates.push({ simania_id: id, via: "reverse" });
          }
        }
        if (page.length < PAGE || checked >= MAX_BOOKS) break;
      }
      if (checked >= MAX_BOOKS) break;
    }
    return { candidates, authorBooks, failed: false };
  } catch {
    return { candidates, authorBooks, failed: true };
  }
}

export async function confirmCandidate(
  work: RematchWork,
  edition: EditionRow,
  authorAgrees: boolean,
  deps: { resolveMatch(edition: EditionRow): Promise<ResolveMatchResult> },
): Promise<{
  accepted: boolean;
  status: "wikidata" | "nli" | "fuzzy" | null;
  book: HardcoverBook | null;
  failed: boolean;
}> {
  if (!authorAgrees) {
    return { accepted: false, status: null, book: null, failed: false };
  }
  const result = await deps.resolveMatch(edition);
  if (!result.found) {
    return { accepted: false, status: null, book: null, failed: result.failed };
  }
  const { book, status } = result.found;
  const accepted = book.id === work.hardcover_id || sameBook(
    { original_title: book.title, original_authors: authors(book) },
    work,
  );
  return { accepted, status, book, failed: false };
}
