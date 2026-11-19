import { assertEquals } from "jsr:@std/assert@1";
import {
  compareFallbackRuns,
  retryWikidata429,
} from "../../scripts/lib/fallback-compare.ts";

function jsonl(...lines: Record<string, unknown>[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

Deno.test("identical fallback files have no changes or losses", () => {
  const run = jsonl(
    {
      hardcover_id: 10,
      title: "Book",
      author: "Author",
      linked: [{ simania_id: 20, resolve_status: "wikidata" }],
      simania_id: 20,
      rule: "A",
    },
    { totals: { works: 1 } },
  );

  const result = compareFallbackRuns(run, run);
  assertEquals(result.changes, []);
  assertEquals(result.lostLinks, []);
  assertEquals(result.exitCode, 0);
  assertEquals(result.counts, {
    changes: 0,
    lost_links: 0,
    unverified: 0,
    only_before: 0,
    only_after: 0,
  });
});

Deno.test("only a replay decision that matched its linked IDs is lost", () => {
  const before = jsonl(
    {
      hardcover_id: 10,
      linked: [{ simania_id: 20, resolve_status: "wikidata" }],
      simania_id: 20,
      rule: "A",
    },
    {
      hardcover_id: 11,
      linked: [{ simania_id: 30, resolve_status: "nli" }],
      simania_id: 31,
      rule: "B",
    },
  );
  const after = jsonl(
    { hardcover_id: 10, linked: [], simania_id: null, rule: null },
    { hardcover_id: 11, linked: [], simania_id: null, rule: null },
  );

  const result = compareFallbackRuns(before, after);
  assertEquals(result.changes.map((change) => change.key), ["10", "11"]);
  assertEquals(result.lostLinks, ["10"]);
  assertEquals(result.exitCode, 1);
});

Deno.test("a changed population key in keep is a lost link", () => {
  const before = jsonl({
    title: "Book",
    author: "Author",
    simania_id: 20,
    rule: "A",
  });
  const after = jsonl({
    title: "Book",
    author: "Author",
    simania_id: 21,
    rule: "B",
  });

  const result = compareFallbackRuns(
    before,
    after,
    new Set(["Book|Author"]),
  );
  assertEquals(result.lostLinks, ["Book|Author"]);
  assertEquals(result.exitCode, 1);
});

Deno.test("provider errors make a key unverified instead of changed", () => {
  const before = jsonl({
    hardcover_id: 10,
    simania_id: 20,
    rule: "A",
  });
  const after = jsonl({
    hardcover_id: 10,
    simania_id: null,
    rule: null,
    errors: ["Wikidata HTTP 500"],
  });

  const result = compareFallbackRuns(before, after);
  assertEquals(result.unverified, ["10"]);
  assertEquals(result.changes, []);
  assertEquals(result.lostLinks, []);
});

Deno.test("keys present in only one fallback file are listed", () => {
  const before = jsonl({ hardcover_id: 10, simania_id: null, rule: null });
  const after = jsonl({ hardcover_id: 11, simania_id: null, rule: null });

  const result = compareFallbackRuns(before, after);
  assertEquals(result.onlyBefore, ["10"]);
  assertEquals(result.onlyAfter, ["11"]);
});

Deno.test("Wikidata 429 retries at most three times and returns only the last result", async () => {
  let attempts = 0;
  let waits = 0;
  const result = await retryWikidata429(
    () => {
      attempts++;
      return Promise.resolve(
        attempts <= 3
          ? { decision: null, providerErrors: ["Wikidata HTTP 429"] }
          : { decision: 42, providerErrors: [] as string[] },
      );
    },
    () => {
      waits++;
      return Promise.resolve();
    },
  );

  assertEquals(attempts, 4);
  assertEquals(waits, 3);
  assertEquals(result, { decision: 42, providerErrors: [] });
});
