import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type AuditDeps,
  type EnglishOnlyRecommendation,
  formatAudit,
  runAudit,
} from "../../scripts/audit-catalog.ts";
import type { LinkProposal } from "../../scripts/lib/link-proposal.ts";

function recommendation(
  hardcover_id: number,
  original_title: string,
): EnglishOnlyRecommendation {
  return {
    display_name: `reader-${hardcover_id}`,
    work_id: `work-${hardcover_id}`,
    hardcover_id,
    original_title,
    original_authors: ["Writer"],
  };
}

function baseDeps(overrides: AuditDeps = {}): AuditDeps {
  return {
    englishOnlyRecommendations: () => Promise.resolve([]),
    linkedEditionsWithWorks: () => Promise.resolve([]),
    shelvedUnlinkedEditions: () => Promise.resolve([]),
    localize: () => Promise.resolve(null),
    proposeLink: (edition) =>
      Promise.resolve({
        simania_id: edition.simania_id,
        original_title: null,
        english_author: null,
        book: null,
        reason: "no_original_title",
      }),
    wikidataEnglishAuthor: () => Promise.resolve(null),
    nameSoundScore: () => 0,
    similarity: (left, right) => left === right ? 1 : 0,
    ...overrides,
  };
}

Deno.test("english_only_with_hebrew includes only recommendations localized to Hebrew", async () => {
  const rows = [recommendation(1, "Spin"), recommendation(2, "No Edition")];
  const report = await runAudit(baseDeps({
    englishOnlyRecommendations: () => Promise.resolve(rows),
    localize: ({ hardcover_id }) =>
      Promise.resolve(
        hardcover_id === 1 ? { simania_id: 97171, title: "סחרור" } : null,
      ),
  }));

  assertEquals(report.english_only_with_hebrew, [{
    display_name: "reader-1",
    hardcover_id: 1,
    english_title: "Spin",
    simania_id: 97171,
    hebrew_title: "סחרור",
  }]);
});

Deno.test("author_mismatches applies sound and Wikidata author checks", async () => {
  const report = await runAudit(baseDeps({
    linkedEditionsWithWorks: () =>
      Promise.resolve([
        {
          simania_id: 10,
          title: "אורורה",
          author: "טוני קפ",
          hardcover_id: 372879,
          original_title: "Aurora",
          original_authors: ["Kim Stanley Robinson"],
        },
        {
          simania_id: 11,
          title: "מתחת לכיפה",
          author: "סטיבן קינג",
          hardcover_id: 384966,
          original_title: "Under the Dome",
          original_authors: ["Stephen King"],
        },
        {
          simania_id: 12,
          title: "ספר",
          author: "שם צלילי",
          hardcover_id: 12,
          original_title: "Book",
          original_authors: ["Sound Name"],
        },
      ]),
    nameSoundScore: (name) => name === "שם צלילי" ? 0.5 : 0,
    wikidataEnglishAuthor: (name) =>
      Promise.resolve(
        name === "טוני קפ"
          ? "Tony Kepp"
          : name === "סטיבן קינג"
          ? "Stephen King"
          : null,
      ),
  }));

  assertEquals(report.author_mismatches, [{
    simania_id: 10,
    hebrew_title: "אורורה",
    hebrew_author: "טוני קפ",
    hardcover_id: 372879,
    english_title: "Aurora",
    english_authors: ["Kim Stanley Robinson"],
  }]);
});

Deno.test("unlinked includes every shelved edition with its proposal or reason", async () => {
  const proposals = new Map<number, LinkProposal>([
    [20, {
      simania_id: 20,
      original_title: "Under the Dome",
      english_author: "Stephen King",
      book: { id: 384966, title: "Under the Dome" },
      reason: "ok",
    }],
    [21, {
      simania_id: 21,
      original_title: null,
      english_author: null,
      book: null,
      reason: "no_original_title",
    }],
  ]);
  const report = await runAudit(baseDeps({
    shelvedUnlinkedEditions: () =>
      Promise.resolve([
        { simania_id: 20, title: "כותרת", author: "סופר" },
        { simania_id: 21, title: "מקור", author: "סופרת" },
      ]),
    proposeLink: (edition) =>
      Promise.resolve(proposals.get(edition.simania_id)!),
  }));

  assertEquals(
    report.unlinked.map(({ simania_id, reason, proposal }) => ({
      simania_id,
      reason,
      proposed: proposal?.book?.id ?? null,
    })),
    [
      { simania_id: 20, reason: "ok", proposed: 384966 },
      { simania_id: 21, reason: "no_original_title", proposed: null },
    ],
  );
});

Deno.test("a recommendation provider error is recorded and localization stays sequential", async () => {
  let active = 0;
  let maxActive = 0;
  const visited: number[] = [];
  const report = await runAudit(baseDeps({
    englishOnlyRecommendations: () =>
      Promise.resolve([
        recommendation(30, "Broken"),
        recommendation(31, "Found"),
      ]),
    localize: async ({ hardcover_id }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      visited.push(hardcover_id);
      await Promise.resolve();
      active--;
      if (hardcover_id === 30) {
        throw new Error("provider secret must not print");
      }
      return { simania_id: 97171, title: "סחרור" };
    },
  }));

  assertEquals(visited, [30, 31]);
  assertEquals(maxActive, 1);
  assertEquals(report.english_only_with_hebrew[0].error, "provider_error");
  assertEquals(report.english_only_with_hebrew[1].simania_id, 97171);
  assertEquals(JSON.stringify(report).includes("provider secret"), false);
});

Deno.test("database failure rejects the audit and JSON output has exactly three sections", async () => {
  await assertRejects(() =>
    runAudit(baseDeps({
      englishOnlyRecommendations: () => Promise.reject(new Error("db down")),
    }))
  );

  const report = await runAudit(baseDeps());
  const parsed = JSON.parse(formatAudit(report, true));
  assertEquals(Object.keys(parsed), [
    "english_only_with_hebrew",
    "author_mismatches",
    "unlinked",
  ]);
});
