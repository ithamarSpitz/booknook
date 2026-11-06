import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type AuditDeps,
  type EnglishOnlyRecommendation,
  findAuthorMismatches,
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
    title: "אורורה",
    author: "טוני קפ",
    hardcover_id: 372879,
    original_title: "Aurora",
    original_authors: ["Kim Stanley Robinson"],
    proposal: {
      simania_id: 10,
      original_title: null,
      english_author: null,
      book: null,
      reason: "no_original_title",
    },
    reason: "no_original_title",
  }]);
});

Deno.test("findAuthorMismatches clears direct author matches before providers and accepts a confirming proposal", async () => {
  const wikidataCalls: number[] = [];
  const proposalCalls: number[] = [];
  const editions = [
    {
      simania_id: 1,
      title: "Not That Kind of Girl",
      author: "Lena Dunham",
      hardcover_id: 1,
      original_title: "Not That Kind of Girl",
      original_authors: ["Lena Dunham"],
    },
    {
      simania_id: 2,
      title: "ספר",
      author: "גלית דיסטל אטבריאן",
      hardcover_id: 2,
      original_title: "ספר",
      original_authors: ["גלית דיסטל אטבריאן"],
    },
    {
      simania_id: 3,
      title: "1984",
      author: "George Orwell",
      hardcover_id: 3,
      original_title: "1984",
      original_authors: ["Fido Nesti", "George Orwell"],
    },
    {
      simania_id: 1002037,
      title: "ספריית חצות",
      author: "מאט הייג",
      hardcover_id: 428018,
      original_title: "The Midnight Library",
      original_authors: ["Matt Haig"],
    },
  ];

  const findings = await findAuthorMismatches(editions, {
    similarity: (left, right) => left === right ? 1 : 0,
    nameSoundScore: () => 0,
    wikidataEnglishAuthor: () => {
      wikidataCalls.push(1002037);
      return Promise.resolve(null);
    },
    proposeLink: (edition) => {
      proposalCalls.push(edition.simania_id);
      return Promise.resolve({
        simania_id: edition.simania_id,
        original_title: "The Midnight Library",
        english_author: "Matt Haig",
        book: { id: 428018, title: "The Midnight Library" },
        reason: "ok",
      });
    },
  });

  assertEquals(findings, []);
  assertEquals(wikidataCalls, [1002037]);
  assertEquals(proposalCalls, [1002037]);
});

Deno.test("findAuthorMismatches includes the input row and the proposed replacement", async () => {
  const proposal: LinkProposal = {
    simania_id: 981260,
    original_title: "The Nightingale",
    english_author: "Kristin Hannah",
    book: { id: 212769, title: "The Nightingale" },
    reason: "ok",
  };
  const findings = await findAuthorMismatches([{
    simania_id: 981260,
    work_id: "work-1912461",
    title: "הזמיר",
    author: "כריסטין האנה",
    hardcover_id: 1912461,
    original_title: "עת הזמיר",
    original_authors: ["Haim Be'er", "חיים באר"],
  }], {
    similarity: (left, right) => left === right ? 1 : 0,
    nameSoundScore: () => 0,
    wikidataEnglishAuthor: () => Promise.resolve("Kristin Hannah"),
    proposeLink: () => Promise.resolve(proposal),
  });

  assertEquals(findings, [{
    simania_id: 981260,
    work_id: "work-1912461",
    title: "הזמיר",
    author: "כריסטין האנה",
    hardcover_id: 1912461,
    original_title: "עת הזמיר",
    original_authors: ["Haim Be'er", "חיים באר"],
    proposal,
    reason: "ok",
  }]);
});

Deno.test("findAuthorMismatches lists a rejected proposal with its reason", async () => {
  const findings = await findAuthorMismatches([{
    simania_id: 40,
    title: "כותרת",
    author: "סופר",
    hardcover_id: 400,
    original_title: "Wrong Book",
    original_authors: ["Other Writer"],
  }], {
    similarity: () => 0,
    nameSoundScore: () => 0,
    wikidataEnglishAuthor: () => Promise.resolve(null),
    proposeLink: (edition) =>
      Promise.resolve({
        simania_id: edition.simania_id,
        original_title: null,
        english_author: null,
        book: null,
        reason: "no_original_title",
      }),
  });

  assertEquals(findings[0].reason, "no_original_title");
  assertEquals(findings[0].proposal?.reason, "no_original_title");
});

Deno.test("findAuthorMismatches records a thrown proposal and continues sequentially", async () => {
  const calls: number[] = [];
  const editions = [50, 51].map((simania_id) => ({
    simania_id,
    title: `title-${simania_id}`,
    author: `author-${simania_id}`,
    hardcover_id: simania_id,
    original_title: `original-${simania_id}`,
    original_authors: [`writer-${simania_id}`],
  }));
  const findings = await findAuthorMismatches(editions, {
    similarity: () => 0,
    nameSoundScore: () => 0,
    wikidataEnglishAuthor: () => Promise.resolve(null),
    proposeLink: (edition) => {
      calls.push(edition.simania_id);
      if (edition.simania_id === 50) throw new Error("provider failed");
      return Promise.resolve({
        simania_id: edition.simania_id,
        original_title: null,
        english_author: null,
        book: null,
        reason: "no_original_title",
      });
    },
  });

  assertEquals(calls, [50, 51]);
  assertEquals(findings[0].error, "provider_error");
  assertEquals(findings[0].proposal, null);
  assertEquals(findings[0].reason, "provider_error");
  assertEquals(findings[1].reason, "no_original_title");
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
