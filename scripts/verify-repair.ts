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

async function loadCases(sql: Sql): Promise<EditionSnapshot[]> {
  const ids = CASES.map((spec) => spec.simaniaId);
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

  const spinMismatch = audit.author_mismatches.some((row) =>
    row.simania_id === 97171
  );
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
