import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import type { Sql } from "npm:postgres@3.4.5";
import {
  applyRepair,
  planRepairs,
  type RepairPlan,
  runRepairLinks,
} from "../../scripts/repair-links.ts";
import type { LinkProposal } from "../../scripts/lib/link-proposal.ts";
import type { HardcoverBook } from "../../supabase/functions/_shared/hardcover.ts";

function book(id: number, title: string): HardcoverBook {
  return {
    id,
    title,
    cached_contributors: [{ author: { name: "English Author" } }],
    cached_similar_book_ids: [7, 8],
    cached_tags: { Genre: [{ tag: "Fiction" }] },
    image: { url: "https://example.test/cover.jpg" },
  };
}

function proposal(
  simaniaId: number,
  reason: LinkProposal["reason"],
): LinkProposal {
  return {
    simania_id: simaniaId,
    original_title: reason === "ok" ? "Original" : null,
    english_author: reason === "ok" ? "English Author" : null,
    book: reason === "ok" ? book(100 + simaniaId, "Original") : null,
    reason,
  };
}

function repairPlan(
  simaniaId = 1,
): Extract<RepairPlan, { kind: "link" }> {
  return {
    kind: "link",
    simania_id: simaniaId,
    title: "כותרת",
    author: "מחבר",
    translator: null,
    original_title: "Original",
    english_author: "English Author",
    book: book(101, "Original"),
    reason: "ok",
  };
}

Deno.test("planRepairs keeps ok proposals, reports other reasons, and is sequential", async () => {
  const rows = [
    { simania_id: 1, title: "א", author: "מחבר" },
    { simania_id: 2, title: "ב", author: "מחבר" },
    { simania_id: 3, title: "ג", author: "מחבר" },
  ];
  const reported: Array<{ id: number; reason: string }> = [];
  const calls: number[] = [];
  let active = 0;
  let maxActive = 0;

  const plans = await planRepairs({
    sql: {} as Sql,
    shelvedUnlinkedEditions: () => Promise.resolve(rows),
    linkedEditionsWithWorks: () => Promise.resolve([]),
    proposeLink: async (edition) => {
      calls.push(edition.simania_id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return proposal(
        edition.simania_id,
        edition.simania_id === 2 ? "no_author_match" : "ok",
      );
    },
    report: (edition, result) =>
      reported.push({ id: edition.simania_id, reason: result.reason }),
  });

  assertEquals(plans.map((plan) => plan.simania_id), [1, 3]);
  assertEquals(reported, [{ id: 2, reason: "no_author_match" }]);
  assertEquals(calls, [1, 2, 3]);
  assertEquals(maxActive, 1);
});

Deno.test("planRepairs adds only actionable relinks to a different Hardcover book", async () => {
  const linked = [
    {
      simania_id: 11,
      work_id: "old-work-11",
      title: "כותרת א",
      author: "מחבר",
      hardcover_id: 201,
      original_title: "Wrong A",
      original_authors: ["Wrong Author"],
    },
    {
      simania_id: 12,
      work_id: "old-work-12",
      title: "כותרת ב",
      author: "מחבר",
      hardcover_id: 202,
      original_title: "Wrong B",
      original_authors: ["Wrong Author"],
    },
    {
      simania_id: 13,
      work_id: "old-work-13",
      title: "כותרת ג",
      author: "מחבר",
      hardcover_id: 203,
      original_title: "Wrong C",
      original_authors: ["Wrong Author"],
    },
  ];
  const reports: number[] = [];
  const plans = await planRepairs({
    sql: {} as Sql,
    shelvedUnlinkedEditions: () => Promise.resolve([]),
    linkedEditionsWithWorks: () => Promise.resolve(linked),
    findAuthorMismatches: () =>
      Promise.resolve([
        {
          ...linked[0],
          proposal: proposal(11, "ok"),
          reason: "ok",
        },
        {
          ...linked[1],
          proposal: {
            ...proposal(12, "ok"),
            book: book(202, "Same book"),
          },
          reason: "ok",
        },
        {
          ...linked[2],
          proposal: proposal(13, "no_author_match"),
          reason: "no_author_match",
        },
      ]),
    reportMismatch: (finding) => reports.push(finding.simania_id),
  });

  assertEquals(plans, [{
    kind: "relink",
    ...linked[0],
    book: book(111, "Original"),
    proposal: proposal(11, "ok") as Extract<
      RepairPlan,
      { kind: "relink" }
    >["proposal"],
  }]);
  assertEquals(reports, [12, 13]);
});

function fakeTransactionalSql(updateRows: unknown[]) {
  const statements: string[] = [];
  const valuesByStatement: unknown[][] = [];
  let call = 0;
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(strings.reduce(
      (text, part, index) => text + part + (index < values.length ? "?" : ""),
      "",
    ));
    valuesByStatement.push(values);
    call += 1;
    return Promise.resolve(call === 1 ? [{ id: "work-uuid" }] : updateRows);
  };
  const sql = {
    begin: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      statements.push("BEGIN");
      const result = await run(tx);
      statements.push("COMMIT");
      return result;
    },
  } as unknown as Sql;
  return { sql, statements, valuesByStatement };
}

Deno.test("applyRepair upserts work then conditionally updates edition in one transaction", async () => {
  const fake = fakeTransactionalSql([{ simania_id: 1 }]);
  const result = await applyRepair(
    fake.sql,
    repairPlan(),
    new Date("2026-11-05T12:00:00Z"),
  );

  assertEquals(result, {
    simania_id: 1,
    status: "linked",
    work_id: "work-uuid",
  });
  assertEquals(fake.statements.length, 4);
  assertEquals(fake.statements[0], "BEGIN");
  assertMatch(fake.statements[1], /insert into public\.works/i);
  assertMatch(fake.statements[1], /on conflict \(hardcover_id\)/i);
  assertMatch(fake.statements[2], /update public\.editions/i);
  assertMatch(fake.statements[2], /work_id is null/i);
  assertEquals(fake.statements[3], "COMMIT");
});

Deno.test("applyRepair reports skipped when the guarded update touches no row", async () => {
  const fake = fakeTransactionalSql([]);
  const result = await applyRepair(fake.sql, repairPlan(), new Date());
  assertEquals(result.status, "skipped");
});

Deno.test("applyRepair relinks only from the old work in one transaction", async () => {
  const fake = fakeTransactionalSql([{ simania_id: 11 }]);
  const plan: RepairPlan = {
    kind: "relink",
    simania_id: 11,
    work_id: "old-work-uuid",
    title: "כותרת",
    author: "מחבר",
    hardcover_id: 201,
    original_title: "Wrong title",
    original_authors: ["Wrong Author"],
    book: book(111, "Original"),
    proposal: proposal(11, "ok") as Extract<
      RepairPlan,
      { kind: "relink" }
    >["proposal"],
  };

  const result = await applyRepair(fake.sql, plan, new Date());

  assertEquals(result.status, "linked");
  assertEquals(fake.statements[0], "BEGIN");
  assertMatch(fake.statements[1], /insert into public\.works/i);
  assertMatch(fake.statements[2], /and work_id = \?/i);
  assertEquals(/work_id is null/i.test(fake.statements[2]), false);
  assertEquals(fake.valuesByStatement[1].includes("old-work-uuid"), true);
  assertEquals(fake.statements[3], "COMMIT");
});

Deno.test("applyRepair reports skipped when a relink no longer has the old work", async () => {
  const fake = fakeTransactionalSql([]);
  const link = repairPlan(14);
  const plan: RepairPlan = {
    kind: "relink",
    simania_id: 14,
    work_id: "old-work-uuid",
    title: link.title,
    author: link.author,
    hardcover_id: 204,
    original_title: "Wrong title",
    original_authors: ["Wrong Author"],
    book: link.book,
    proposal: link,
  };
  const result = await applyRepair(fake.sql, plan, new Date());
  assertEquals(result.status, "skipped");
});

Deno.test("dry run opens read-only and never applies a repair", async () => {
  const openOptions: Array<{ readOnly?: boolean }> = [];
  const logs: string[] = [];
  let applies = 0;
  let ended = 0;
  const sql = {
    end: () => {
      ended += 1;
    },
  } as unknown as Sql;

  const code = await runRepairLinks([], {
    loadOperatorEnv: () => ({ dbPassword: "unused" }),
    openProdDb: (options) => {
      openOptions.push(options ?? {});
      return Promise.resolve(sql);
    },
    planRepairs: () =>
      Promise.resolve([repairPlan(), {
        kind: "relink",
        simania_id: 11,
        work_id: "old-work-uuid",
        title: "כותרת",
        author: "מחבר",
        hardcover_id: 201,
        original_title: "Wrong title",
        original_authors: ["Wrong Author"],
        book: book(111, "Original"),
        proposal: repairPlan(11),
      }]),
    applyRepair: () => {
      applies += 1;
      return Promise.resolve({
        simania_id: 1,
        status: "linked",
        work_id: "work-uuid",
      });
    },
    log: (message) => logs.push(message),
  });

  assertEquals(code, 0);
  assertEquals(openOptions, [{ readOnly: true }]);
  assertEquals(applies, 0);
  assertEquals(ended, 1);
  assertEquals(JSON.parse(logs[1]), {
    kind: "relink",
    simania_id: 11,
    title: "כותרת",
    from: { hardcover_id: 201, title: "Wrong title" },
    to: { hardcover_id: 101, title: "Original" },
    evidence: { english_author: "English Author" },
  });
});
