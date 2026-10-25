import type { CachedTags, WorkRow } from "../_shared/types.ts";

export type LibraryItem = {
  simania_id: number;
  position: number;
  added_at: string;
  finished_at: string | null;
  shelf_kind: string;
  rating: number | null;
  title: string;
  work: WorkRow | null;
};

export type ScoredCandidate = {
  hardcover_id: number;
  score: number;
  because: number[];
};

export type Seed = LibraryItem & { weight: number };

/** Weight of an unrated book on the "read" shelf: neutral, never shown to users. */
export const UNRATED_READ_WEIGHT = 2.5;

/**
 * How much a shelved book pulls recommendations toward its similar books:
 * its rating when 3-5 (on any shelf), 2.5 when unrated on "read", otherwise 0.
 * Ratings 1-2 and unrated books on other shelves are not seeds.
 */
export function seedWeight(item: Pick<LibraryItem, "rating" | "shelf_kind">): number {
  if (item.rating != null) return item.rating >= 3 ? item.rating : 0;
  return item.shelf_kind === "read" ? UNRATED_READ_WEIGHT : 0;
}

function descendingDate(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

/** Every book with a positive weight, strongest first (that order also orders the reasons). */
export function selectSeeds(items: LibraryItem[]): Seed[] {
  return items
    .filter((item) => item.work)
    .map((item) => ({ ...item, weight: seedWeight(item) }))
    .filter((seed) => seed.weight > 0)
    .sort((a, b) =>
      b.weight - a.weight ||
      descendingDate(a.finished_at, b.finished_at) ||
      descendingDate(a.added_at, b.added_at) || a.simania_id - b.simania_id
    );
}

/** Sum over seeds of weight x closeness, closeness = 1 - rank/40 in the seed's Hardcover similar list. */
export function scoreCandidates(seeds: Seed[]): ScoredCandidate[] {
  const scores = new Map<number, { score: number; because: number[] }>();
  for (const seed of seeds) {
    for (
      const [rank, id] of (seed.work?.similar_ids ?? []).slice(0, 40).entries()
    ) {
      if (!Number.isInteger(id)) continue;
      const current = scores.get(id) ?? { score: 0, because: [] };
      current.score += seed.weight * (1 - rank / 40);
      if (!current.because.includes(seed.simania_id)) {
        current.because.push(seed.simania_id);
      }
      scores.set(id, current);
    }
  }
  return [...scores].map(([hardcover_id, value]) => ({
    hardcover_id,
    ...value,
  }))
    .sort((a, b) => b.score - a.score || a.hardcover_id - b.hardcover_id);
}

export function excludeCandidates(
  candidates: ScoredCandidate[],
  worksByHardcoverId: Map<number, WorkRow>,
  shelvedWorkIds: Set<string>,
  dismissedWorkIds: Set<string>,
): ScoredCandidate[] {
  return candidates.filter((candidate) => {
    const work = worksByHardcoverId.get(candidate.hardcover_id);
    return !work ||
      (!shelvedWorkIds.has(work.id) && !dismissedWorkIds.has(work.id));
  });
}

export function cleanCachedTags(value: unknown): CachedTags {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: CachedTags = {};
  for (const [category, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    const valid = entries.filter((
      entry,
    ): entry is { tag: string; [key: string]: unknown } =>
      Boolean(entry) && typeof entry === "object" &&
      typeof (entry as { tag?: unknown }).tag === "string" &&
      (entry as { tag: string }).tag.trim().length > 0
    );
    if (valid.length) result[category] = valid;
  }
  return result;
}

export function extractedTags(tags: CachedTags): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const category of ["Genre", "Mood"]) {
    for (const entry of tags[category] ?? []) {
      if (!seen.has(entry.tag)) {
        seen.add(entry.tag);
        result.push(entry.tag);
      }
    }
  }
  return result;
}

export function sharedTags(
  candidate: CachedTags,
  contributingSeeds: CachedTags[],
): string[] {
  const seedTags = new Set(contributingSeeds.flatMap(extractedTags));
  return extractedTags(candidate).filter((tag) => seedTags.has(tag));
}
