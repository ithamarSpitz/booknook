import type { CachedTags, WorkRow } from "../_shared/types.ts";

export type LibraryItem = {
  simania_id: number;
  position: number;
  added_at: string;
  finished_at: string | null;
  shelf_kind: string;
  title: string;
  work: WorkRow | null;
};

export type ScoredCandidate = {
  hardcover_id: number;
  score: number;
  because: number[];
};

function descendingDate(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

export function selectSeeds(items: LibraryItem[], limit = 8): LibraryItem[] {
  const reading = items.filter((item) =>
    item.shelf_kind === "reading" && item.work
  )
    .sort((a, b) => a.position - b.position || a.simania_id - b.simania_id);
  const read = items.filter((item) => item.shelf_kind === "read" && item.work)
    .sort((a, b) =>
      descendingDate(a.finished_at, b.finished_at) ||
      descendingDate(a.added_at, b.added_at) || a.simania_id - b.simania_id
    );
  return [...reading, ...read].slice(0, limit);
}

export function scoreCandidates(seeds: LibraryItem[]): ScoredCandidate[] {
  const scores = new Map<number, { score: number; because: number[] }>();
  for (const seed of seeds) {
    for (
      const [rank, id] of (seed.work?.similar_ids ?? []).slice(0, 40).entries()
    ) {
      if (!Number.isInteger(id)) continue;
      const current = scores.get(id) ?? { score: 0, because: [] };
      current.score += 1 - rank / 40;
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
