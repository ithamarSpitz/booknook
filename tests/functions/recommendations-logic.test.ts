import {
  cleanCachedTags,
  excludeCandidates,
  type LibraryItem,
  scoreCandidates,
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
): LibraryItem {
  return {
    simania_id: simaniaId,
    shelf_kind: kind,
    position,
    work: value,
    title: String(simaniaId),
    added_at: `2026-01-0${simaniaId}T00:00:00Z`,
    finished_at: finished,
  };
}

Deno.test("selectSeeds prioritizes reading position then recent completed books", () => {
  const selected = selectSeeds([
    item(1, "read", 0, work("a", 1), "2025-01-01T00:00:00Z"),
    item(2, "reading", 1, work("b", 2)),
    item(3, "reading", 0, work("c", 3)),
    item(4, "want", 0, work("d", 4)),
    item(5, "read", 1, work("e", 5), "2026-01-01T00:00:00Z"),
  ]);
  equal(selected.map((seed) => seed.simania_id), [3, 2, 5, 1]);
});

Deno.test("scoring deduplicates reasons and exclusions cover shelved and dismissed works", () => {
  const seeds = [item(11, "reading", 0, work("seed", 1, [2, 3, 2]))];
  const scored = scoreCandidates(seeds);
  equal(scored[0], { hardcover_id: 2, score: 1.95, because: [11] });
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
