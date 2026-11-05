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

function repairPlan(simaniaId = 1): RepairPlan {
  return {
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

function fakeTransactionalSql(updateRows: unknown[]) {
  const statements: string[] = [];
  let call = 0;
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(strings.reduce(
      (text, part, index) => text + part + (index < values.length ? "?" : ""),
      "",
    ));
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
  return { sql, statements };
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

Deno.test("dry run opens read-only and never applies a repair", async () => {
  const openOptions: Array<{ readOnly?: boolean }> = [];
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
    planRepairs: () => Promise.resolve([repairPlan()]),
    applyRepair: () => {
      applies += 1;
      return Promise.resolve({
        simania_id: 1,
        status: "linked",
        work_id: "work-uuid",
      });
    },
    log: () => {},
  });

  assertEquals(code, 0);
  assertEquals(openOptions, [{ readOnly: true }]);
  assertEquals(applies, 0);
  assertEquals(ended, 1);
});
