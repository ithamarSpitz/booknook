import type { Sql } from "npm:postgres@3.4.5";
import { type AuditReport, runAudit } from "./audit-catalog.ts";
import {
  planRepairs,
  type RepairEdition,
  type RepairPlan,
} from "./repair-links.ts";
import { openProdDb } from "./lib/prod-db.ts";

interface RepairCase {
  simaniaId: number;
  title: string;
  expectedHardcoverId: number | null;
}

interface RelinkCase {
  simaniaId: number;
  title: string;
  fromHardcoverId: number;
  toHardcoverId: number;
}

interface EditionSnapshot extends RepairEdition {
  work_id: string | null;
  hardcover_id: number | null;
}

const CASES: RepairCase[] = [
  {
    simaniaId: 905132,
    title: "מתחת לכיפה השקופה",
    expectedHardcoverId: 384966,
  },
  {
    simaniaId: 1026572,
    title: "עוזרת הבית רואה הכול",
    expectedHardcoverId: 994242,
  },
  { simaniaId: 1027968, title: "הקולגה", expectedHardcoverId: 872020 },
  {
    simaniaId: 1014927,
    title: "רק לקיץ הזה",
    expectedHardcoverId: 884117,
  },
  {
    simaniaId: 1024649,
    title: "מרגו צריכה כסף",
    expectedHardcoverId: 1237058,
  },
  {
    simaniaId: 1028062,
    title: "המדריך למכשפה מהעבר לדייטים מודרניים",
    expectedHardcoverId: 1949170,
  },
  { simaniaId: 659042, title: "ואם היו אומרים לך", expectedHardcoverId: null },
  {
    simaniaId: 997869,
    title: "אף אחד לא עוזב את פאלו אלטו",
    expectedHardcoverId: null,
  },
  { simaniaId: 1028464, title: "תמרה משקרת", expectedHardcoverId: null },
];

const RELINK_CASES: RelinkCase[] = [
  {
    simaniaId: 981260,
    title: "הזמיר",
    fromHardcoverId: 1912461,
    toHardcoverId: 212769,
  },
  {
    simaniaId: 374138,
    title: "זודיאק",
    fromHardcoverId: 149306,
    toHardcoverId: 192875,
  },
  {
    simaniaId: 997264,
    title: "משכילה",
    fromHardcoverId: 1018039,
    toHardcoverId: 44186,
  },
  {
    simaniaId: 1009943,
    title: "רוחות הזעם",
    fromHardcoverId: 606688,
    toHardcoverId: 880804,
  },
];

const NOT_FLAGGED_CASES = [
  { simaniaId: 1027273, title: "Famesick" },
  { simaniaId: 1028721, title: "Yesteryear" },
  { simaniaId: 86443, title: "טווס בחדר מדרגות" },
  { simaniaId: 810722, title: "1984" },
  { simaniaId: 1002037, title: "ספריית חצות" },
];

async function loadCases(sql: Sql): Promise<EditionSnapshot[]> {
  const ids = [
    ...CASES.map((spec) => spec.simaniaId),
    ...RELINK_CASES.map((spec) => spec.simaniaId),
  ];
  return await sql<EditionSnapshot[]>`
    select
      e.simania_id,
      e.title,
      e.author,
      e.translator,
      e.work_id,
      w.hardcover_id
    from public.editions as e
    left join public.works as w on w.id = e.work_id
    where e.simania_id = any(${ids})
    order by e.simania_id
  `;
}

function caseLine(
  pass: boolean,
  spec: RepairCase,
  actual: number | null,
  detail: string,
): string {
  const expected = spec.expectedHardcoverId ?? "no proposal";
  const got = actual ?? "no proposal";
  const suffix = detail ? ` (${detail})` : "";
  return `${
    pass ? "PASS" : "FAIL"
  } Simania ${spec.simaniaId} ${spec.title} got ${got} expected ${expected}${suffix}`;
}

function safeCause(error: unknown): string {
  let message = error instanceof Error ? error.message : "Unknown failure.";
  const secrets = [Deno.env.get("HARDCOVER_API_KEY")]
    .filter((value): value is string => Boolean(value));
  for (const secret of secrets) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message.replace(
    /((?:password|api[_ -]?key|token)\s*[:=]\s*)\S+/gi,
    "$1[REDACTED]",
  );
}

async function verify(sql: Sql): Promise<number> {
  const snapshots = await loadCases(sql);
  const byId = new Map(snapshots.map((row) => [row.simania_id, row]));
  const rejected = new Map<number, string>();
  const plans = await planRepairs({
    sql,
    shelvedUnlinkedEditions: () =>
      Promise.resolve(snapshots.filter((row) => row.work_id === null)),
    report: (edition, proposal) => {
      rejected.set(edition.simania_id, proposal.reason);
    },
  });
  const planById = new Map<number, RepairPlan>(
    plans.map((plan) => [plan.simania_id, plan]),
  );
  const relinkPlans = plans.filter((plan) => plan.kind === "relink");
  for (const plan of relinkPlans) {
    console.log(`RELINK ${
      JSON.stringify({
        simania_id: plan.simania_id,
        title: plan.title,
        from: {
          hardcover_id: plan.hardcover_id,
          title: plan.original_title,
        },
        to: {
          hardcover_id: plan.book.id,
          title: plan.book.title,
        },
      })
    }`);
  }

  const providerFailure = [...rejected.entries()].find(([, reason]) =>
    reason === "provider_error"
  );

  let failed = false;
  for (const spec of CASES) {
    const row = byId.get(spec.simaniaId);
    let actual: number | null = null;
    let detail = "";

    if (!row) {
      failed = true;
      detail = "edition missing from production";
    } else if (row.work_id !== null) {
      actual = row.hardcover_id;
      if (
        spec.expectedHardcoverId === null ||
        actual !== spec.expectedHardcoverId
      ) {
        failed = true;
        detail = spec.expectedHardcoverId === null
          ? "Hebrew original is already linked"
          : "current link differs";
      }
    } else {
      actual = planById.get(spec.simaniaId)?.book.id ?? null;
      const rejection = rejected.get(spec.simaniaId);
      if (rejection === "provider_error") {
        failed = true;
        detail = rejection;
      } else if (actual !== spec.expectedHardcoverId) {
        failed = true;
        detail = rejection ?? "unexpected proposal";
      }
    }

    console.log(caseLine(!detail, spec, actual, detail));
  }

  casesPrinted = true;
  if (providerFailure) {
    throw new Error(
      `Provider failure while checking Simania ${providerFailure[0]}.`,
    );
  }

  let audit: AuditReport;
  try {
    audit = await runAudit({ sql });
  } catch (error) {
    console.log("FAIL audit could not complete all three sections");
    throw error;
  }
  const auditSections = [
    audit.english_only_with_hebrew,
    audit.author_mismatches,
    audit.unlinked,
  ];
  if (auditSections.some((section) => section.some((row) => row.error))) {
    console.log("FAIL audit contains a provider error");
    throw new Error("A provider failure prevented a clean catalog audit.");
  }

  const mismatches = audit.author_mismatches;
  const mismatchIds = new Set(
    mismatches.map((row) => row.simania_id),
  );
  const unflaggedRelinkPlans = relinkPlans.filter((plan) =>
    !mismatchIds.has(plan.simania_id)
  );
  if (unflaggedRelinkPlans.length > 0) failed = true;
  console.log(
    `${
      unflaggedRelinkPlans.length === 0 ? "PASS" : "FAIL"
    } every relink plan targets a flagged author mismatch`,
  );

  for (const spec of RELINK_CASES) {
    const row = byId.get(spec.simaniaId);
    const plan = relinkPlans.find((candidate) =>
      candidate.simania_id === spec.simaniaId
    );
    const alreadyLinked = row?.hardcover_id === spec.toHardcoverId;
    const planned = plan?.hardcover_id === spec.fromHardcoverId &&
      plan.book.id === spec.toHardcoverId;
    const pass = alreadyLinked || planned;
    if (!pass) failed = true;
    const actual = row === undefined
      ? "edition missing from production"
      : alreadyLinked
      ? `already linked to ${spec.toHardcoverId}`
      : plan === undefined
      ? `no relink plan from current ${row.hardcover_id}`
      : `planned ${plan.hardcover_id} -> ${plan.book.id}`;
    console.log(
      `${pass ? "PASS" : "FAIL"} Simania ${spec.simaniaId} ${spec.title} ` +
        `relink ${spec.fromHardcoverId} -> ${spec.toHardcoverId} (${actual})`,
    );
  }

  for (const spec of NOT_FLAGGED_CASES) {
    const flagged = mismatchIds.has(spec.simaniaId);
    if (flagged) failed = true;
    console.log(
      `${flagged ? "FAIL" : "PASS"} Simania ${spec.simaniaId} ${spec.title} ` +
        "absent from author_mismatches",
    );
  }

  const spinMismatch = mismatches.some((row) => row.simania_id === 97171);
  console.log(
    `${
      spinMismatch ? "FAIL" : "PASS"
    } audit three sections complete; Simania 97171 absent from author_mismatches`,
  );
  return failed || spinMismatch ? 1 : 0;
}

let sql: Sql | undefined;
let exitCode = 2;
let casesPrinted = false;
try {
  sql = await openProdDb({ readOnly: true });
  exitCode = await verify(sql);
} catch (error) {
  if (!casesPrinted) {
    for (const spec of CASES) {
      console.log(caseLine(false, spec, null, "run unavailable"));
    }
  }
  console.error(`ERROR verify:repair could not complete: ${safeCause(error)}`);
} finally {
  if (sql !== undefined) {
    try {
      await sql.end();
    } catch (error) {
      console.error(`ERROR closing production database: ${safeCause(error)}`);
      exitCode = 2;
    }
  }
}

Deno.exit(exitCode);
