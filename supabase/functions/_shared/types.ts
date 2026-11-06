import type { SimaniaBook as SimaniaBookShape } from "./simania.ts";

/** The provider-owned search result shape; kept as an alias, not duplicated. */
export type SimaniaBook = SimaniaBookShape;

export type ShelfKind = "reading" | "read" | "want" | "stopped" | "custom";

export type ResolveStatus =
  | "pending"
  | "wikidata"
  | "nli"
  | "fuzzy"
  | "llm"
  | "not_found"
  | "hardcover"
  | "original_title";

export interface ProfileRow {
  id: string;
  display_name: string;
  locale: string;
  created_at: string;
}

/** Validated provider cache entries; tag names are preserved verbatim. */
export interface CachedTag {
  tag: string;
  [metadata: string]: unknown;
}

/** Only Genre and Mood participate in shared-tag extraction. */
export type CachedTags = Partial<Record<string, CachedTag[]>>;

export interface WorkRow {
  id: string;
  hardcover_id: number | null;
  original_title: string;
  original_authors: string[];
  similar_ids: number[];
  tags: CachedTags;
  hardcover_cover_url: string | null;
  refreshed_at: string | null;
}

export interface EditionRow {
  simania_id: number;
  work_id: string | null;
  resolve_status: ResolveStatus;
  resolved_at: string | null;
  title: string;
  author: string | null;
  translator: string | null;
  publisher: string | null;
  series: string | null;
  category: string | null;
  year: number | null;
  pages: number | null;
  description: string | null;
  cover_url: string | null;
  simania_rating: number | null;
  simania_rating_count: number | null;
  details_at: string | null;
}

export interface ShelfRow {
  id: string;
  user_id: string;
  name: string;
  kind: ShelfKind;
  position: number;
  created_at: string;
}

export interface ShelfBookRow {
  user_id: string;
  simania_id: number;
  shelf_id: string;
  position: number;
  added_at: string;
  finished_at: string | null;
  rating: number | null;
}

export interface RecommendationRow {
  user_id: string;
  work_id: string;
  simania_id: number | null;
  score: number;
  because: number[];
  shared_tags: string[];
  dismissed: boolean;
  generated_at: string;
}

export interface SearchCacheRow {
  query_norm: string;
  results: SimaniaBook[];
  fetched_at: string;
}

export interface BookCard {
  /** Negative for an English edition: -hardcover_id. */
  simania_id: number;
  /** True when simania_id < 0 (an English edition from Hardcover, not on Simania). */
  english_edition?: boolean;
  work_id: string | null;
  resolve_status: ResolveStatus;
  title: string;
  author: string | null;
  translator: string | null;
  publisher: string | null;
  series: string | null;
  category: string | null;
  year: number | null;
  pages: number | null;
  description: string | null;
  cover_url: string | null;
  simania_rating: number | null;
  simania_rating_count: number | null;
  shelf_id: string | null;
  shelf_name: string | null;
  shelf_kind: ShelfKind | null;
  position: number | null;
  added_at: string | null;
  finished_at: string | null;
  rating: number | null;
}

export interface RecommendationCard {
  work_id: string;
  /** works.hardcover_id; English-only cards are added with add-book { hardcover_id }. */
  hardcover_id?: number;
  simania_id: number | null;
  title: string;
  author: string | null;
  cover_url: string | null;
  score: number;
  because: number[];
  because_titles: string[];
  shared_tags: string[];
  dismissed: boolean;
  generated_at: string;
  english_only: boolean;
  can_add: boolean;
  /** English-only cards: Hebrew title from the Wikidata/NLI bridge, for the browser's Simania match. */
  hebrew_hint: HebrewHint | null;
  /** English-only cards: the author's Hebrew name, for the browser's Simania author search; null when unknown. */
  hebrew_author?: string | null;
}

export interface HebrewHint {
  source: "wikidata" | "nli";
  title: string;
  author: string | null;
}

export interface LinkEditionRequest {
  work_id: string;
  simania_id: number;
  source: HebrewHint["source"];
  simania: { details: Record<string, unknown>; rating: Record<string, unknown> | null };
}

/** The localized fields that replace the English-only ones on the card. */
export interface AuthorCandidate {
  simania_id: number;
  title: string;
  author: string | null;
}

export interface MatchByAuthorRequest {
  work_id: string;
  candidates: AuthorCandidate[];
}

export interface MatchByAuthorResponse {
  /** The candidate that resolves to exactly this work, or null. */
  simania_id: number | null;
  /** That edition's resolve status (`wikidata`, `nli` or `fuzzy`), or null. */
  resolve_status: ResolveStatus | null;
}

export interface LinkEditionResponse {
  work_id: string;
  simania_id: number;
  title: string;
  author: string | null;
  cover_url: string | null;
}

export interface SearchEnglishRequest {
  query: string;
}

export interface EnglishBook {
  hardcover_id: number;
  title: string;
  author: string | null;
  year: number | null;
  cover_url: string | null;
}

export interface SearchEnglishResponse {
  books: EnglishBook[];
}

export interface GenreRecommendationRow {
  user_id: string;
  work_id: string;
  genre: string;
  shelf_position: number;
  position: number;
  simania_id: number | null;
  score: number;
  generated_at: string;
}

/** One item of the replace_genre_recommendations payload. */
export interface GenreRecommendationReplacement {
  work_id: string;
  genre: string;
  shelf_position: number;
  position: number;
  simania_id: number | null;
  score: number;
  because: number[];
}

export interface GenreBook {
  work_id: string;
  hardcover_id: number;
  simania_id: number | null;
  title: string;
  author: string | null;
  cover_url: string | null;
  english_only: boolean;
  because: number[];
  because_titles: string[];
}

export interface GenreShelf {
  genre: string;
  books: GenreBook[];
}

export interface ErrorResponse {
  error: string;
}

export interface SearchBooksRequest {
  query: string;
}

export interface SearchBooksResponse {
  books: SimaniaBook[];
}

export interface AddBookRequest {
  /** Exactly one of simania_id (a Simania edition) or hardcover_id (an English edition). */
  simania_id?: number;
  hardcover_id?: number;
  shelf_id: string;
  /** Raw Simania `books_get_details` / `books_get_rating` results fetched by the browser. */
  simania?: { details: Record<string, unknown>; rating: Record<string, unknown> | null };
}

export interface AddBookResponse {
  book: BookCard;
  resolve_status: ResolveStatus;
}

export interface BookDetailsRequest {
  simania_id: number;
  /** Raw Simania `books_get_details` / `books_get_rating` results fetched by the browser. */
  simania?: { details: Record<string, unknown>; rating: Record<string, unknown> | null };
}

export interface BookDetailsResponse {
  book: BookCard;
}

/** Any JSON object is accepted; all properties are ignored. */
export type RecommendationsRequest = Record<string, unknown>;

export interface RecommendationsResponse {
  recommendations: RecommendationCard[];
}

export interface MoveBookArgs {
  p_simania_id: number;
  p_to_shelf: string;
  p_to_position: number;
}

export interface MoveShelfArgs {
  p_shelf_id: string;
  p_to_position: number;
}

export interface DeleteShelfArgs {
  p_shelf_id: string;
}

export interface RemoveBookArgs {
  p_simania_id: number;
}

/** PostgreSQL `void` is returned by PostgREST as JSON null. */
export type MoveBookResult = null;
export type MoveShelfResult = null;
export type DeleteShelfResult = null;
export type RemoveBookResult = null;

/** Service-only atomic replacement payload; user/time/dismissal are server-owned. */
export type RecommendationReplacement = Pick<
  RecommendationRow,
  "work_id" | "simania_id" | "score" | "because" | "shared_tags"
>;

export interface ReplaceRecommendationsArgs {
  p_user_id: string;
  p_rows: RecommendationReplacement[];
}

export type ReplaceRecommendationsResult = RecommendationRow[];

export interface InviteUserRequest {
  email: string;
}

export interface InvitationRow {
  email: string;
  created_at: string;
}

export interface InviteUserResponse {
  invitation: InvitationRow;
}
