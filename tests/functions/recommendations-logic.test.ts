import {
  cleanCachedTags,
  excludeCandidates,
  type LibraryItem,
  scoreCandidates,
  seedWeight,
  selectSeeds,
  sharedTags,
} from "../../supabase/functions/recommendations/logic.ts";
import type { WorkRow } from "../../supabase/functions/_shared/types.ts";

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function work(
  id: string,
  hardcoverId: number,
  similar: number[] = [],
  tags: WorkRow["tags"] = {},
): WorkRow {
  return {
    id,
    hardcover_id: hardcoverId,
    original_title: id,
    original_authors: [],
    similar_ids: similar,
    tags,
    hardcover_cover_url: null,
    refreshed_at: null,
  };
}

function item(
  simaniaId: number,
  kind: string,
  position: number,
  value: WorkRow | null,
  finished: string | null = null,
  rating: number | null = null,
): LibraryItem {
  return {
    simania_id: simaniaId,
    shelf_kind: kind,
    rating,
    position,
    work: value,
    title: String(simaniaId),
    added_at: `2026-01-0${simaniaId}T00:00:00Z`,
    finished_at: finished,
  };
}

Deno.test("seed weight: rating 3-5 on any shelf, 2.5 for unrated read books, otherwise not a seed", () => {
  equal(
    [
      seedWeight({ shelf_kind: "want", rating: 5 }),
      seedWeight({ shelf_kind: "reading", rating: 3 }),
      seedWeight({ shelf_kind: "read", rating: 2 }),
      seedWeight({ shelf_kind: "read", rating: 1 }),
      seedWeight({ shelf_kind: "read", rating: null }),
      seedWeight({ shelf_kind: "reading", rating: null }),
      seedWeight({ shelf_kind: "stopped", rating: null }),
      seedWeight({ shelf_kind: "custom", rating: null }),
    ],
    [5, 3, 0, 0, 2.5, 0, 0, 0],
  );
});

Deno.test("selectSeeds keeps every weighted book, strongest first, with no count limit", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    item(100 + i, "read", i, work(`r${i}`, 100 + i), `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
  const selected = selectSeeds([
    ...many,
    item(1, "reading", 0, work("a", 1)),
    item(2, "want", 0, work("b", 2), null, 4),
    item(3, "read", 0, work("c", 3), null, 2),
    item(4, "stopped", 0, work("d", 4), null, 5),
  ]);
  equal(selected.length, 14);
  equal(selected.slice(0, 3).map((seed) => [seed.simania_id, seed.weight]), [[4, 5], [2, 4], [111, 2.5]]);
});

Deno.test("scores multiply closeness by seed weight and sum across seeds", () => {
  const seeds = selectSeeds([
    item(11, "read", 0, work("five", 1, [7, 8]), null, 5),
    item(12, "read", 1, work("unrated", 2, [8])),
  ]);
  const scored = scoreCandidates(seeds);
  // 8: 5 x (1 - 1/40) + 2.5 x 1 = 7.375; 7: 5 x 1 = 5
  equal(scored.map((c) => [c.hardcover_id, c.score, c.because]), [[8, 7.375, [11, 12]], [7, 5, [11]]]);
});

Deno.test("scoring deduplicates reasons and exclusions cover shelved and dismissed works", () => {
  const seeds = selectSeeds([item(11, "read", 0, work("seed", 1, [2, 3, 2]), null, 4)]);
  const scored = scoreCandidates(seeds);
  equal(scored[0], { hardcover_id: 2, score: 7.8, because: [11] });
  const works = new Map([[2, work("shelved", 2)], [3, work("dismissed", 3)]]);
  equal(
    excludeCandidates(
      scored,
      works,
      new Set(["shelved"]),
      new Set(["dismissed"]),
    ),
    [],
  );
});

Deno.test("shared tags use only valid stored Genre and Mood tags in candidate order", () => {
  const candidate = cleanCachedTags({
    Genre: [{ tag: "fantasy" }, { tag: "" }, null],
    Mood: [{ tag: "quiet" }, { tag: "fantasy" }],
    Subject: [{ tag: "ignored" }],
  });
  const seed = cleanCachedTags({
    Genre: [{ tag: "quiet" }, { tag: "fantasy" }],
  });
  equal(sharedTags(candidate, [seed]), ["fantasy", "quiet"]);
});
