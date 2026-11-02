import { ensureResolved } from "../supabase/functions/_shared/catalog.ts";
import type { EditionRow, ResolveStatus } from "../supabase/functions/_shared/types.ts";
import { edition, FakeDb } from "../tests/functions/helpers/fake-db.ts";

const NOW = new Date("2026-10-25T10:00:00.000Z");
type CaseSpec = {
  simania_id: number;
  title: string;
  author: string;
  buildDb: () => Record<string, Record<string, unknown>[]>;
  check: (
    row: EditionRow,
    work: Record<string, unknown> | null,
  ) => { ok: boolean; detail: string };
};

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadHardcoverApiKey(): void {
  if (Deno.env.get("HARDCOVER_API_KEY")?.trim()) return;

  const envFile = Deno.env.get("BOOKNOOK_ENV_FILE")?.trim();
  if (!envFile) {
    console.error(
      "HARDCOVER_API_KEY is missing. Set it in the environment or BOOKNOOK_ENV_FILE to a file that contains it.",
    );
    Deno.exit(1);
  }

  let text: string;
  try {
    text = Deno.readTextFileSync(envFile);
  } catch {
    console.error(
      "HARDCOVER_API_KEY is missing. Set it in the environment or BOOKNOOK_ENV_FILE to a file that contains it.",
    );
    Deno.exit(1);
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== "HARDCOVER_API_KEY") continue;
    const value = parseEnvValue(trimmed.slice(eq + 1));
    if (!value) break;
    Deno.env.set("HARDCOVER_API_KEY", value);
    return;
  }

  console.error(
    "HARDCOVER_API_KEY is missing. Set it in the environment or BOOKNOOK_ENV_FILE to a file that contains it.",
  );
  Deno.exit(1);
}

function bridgeStatuses(): ResolveStatus[] {
  return ["wikidata", "nli"];
}

function expectHardcover(
  hardcoverId: number,
  statuses: ResolveStatus[] = bridgeStatuses(),
) {
  return (
    row: EditionRow,
    work: Record<string, unknown> | null,
  ): { ok: boolean; detail: string } => {
    if (!statuses.includes(row.resolve_status)) {
      return { ok: false, detail: `expected status ${statuses.join("|")}` };
    }
    if (work?.hardcover_id !== hardcoverId) {
      return {
        ok: false,
        detail: `expected hardcover ${hardcoverId}, got ${work?.hardcover_id ?? "null"}`,
      };
    }
    return { ok: true, detail: "" };
  };
}

const CASES: CaseSpec[] = [
  {
    simania_id: 1008974,
    title: "הדירה בפריז",
    author: "לוסי פולי",
    buildDb: () => ({
      works: [{
        id: "seed-work-foley",
        hardcover_id: 999,
        original_title: "The Guest List",
        original_authors: ["Lucy Foley"],
        similar_ids: [],
        tags: {},
        hardcover_cover_url: null,
        refreshed_at: null,
      }],
      editions: [
        edition({
          simania_id: 1001027,
          title: "רשימת המוזמנים",
          author: "לוסי פולי",
          work_id: "seed-work-foley",
          resolve_status: "nli",
          resolved_at: "2026-10-01T10:00:00.000Z",
        }),
        edition({
          simania_id: 1008974,
          title: "הדירה בפריז",
          author: "לוסי פולי",
        }),
      ],
    }),
    check: expectHardcover(463025, ["nli"]),
  },
  {
    simania_id: 976507,
    title: "חפצים חדים (2015)",
    author: "גיליאן פלין",
    buildDb: () => ({
      editions: [edition({
        simania_id: 976507,
        title: "חפצים חדים (2015)",
        author: "גיליאן פלין",
      })],
    }),
    check: expectHardcover(130839),
  },
  {
    simania_id: 977114,
    title: "ההיסטוריה הסודית [מהדורת מודן - 2015]",
    author: "דונה טארט",
    buildDb: () => ({
      editions: [edition({
        simania_id: 977114,
        title: "ההיסטוריה הסודית [מהדורת מודן - 2015]",
        author: "דונה טארט",
      })],
    }),
    check: expectHardcover(166849),
  },
  {
    simania_id: 989039,
    title: "הנסיכה הקסומה [מהדורת 2018]",
    author: "ויליאם גולדמן",
    buildDb: () => ({
      editions: [edition({
        simania_id: 989039,
        title: "הנסיכה הקסומה [מהדורת 2018]",
        author: "ויליאם גולדמן",
      })],
    }),
    check: expectHardcover(283102),
  },
  {
    simania_id: 1028145,
    title: "מחר ועוד מחר ועוד מחר [עטיפה חדשה]",
    author: "גבריאל זווין",
    buildDb: () => ({
      editions: [edition({
        simania_id: 1028145,
        title: "מחר ועוד מחר ועוד מחר [עטיפה חדשה]",
        author: "גבריאל זווין",
      })],
    }),
    check: expectHardcover(479910),
  },
  {
    simania_id: 956502,
    title: "עין החתול [מהדורת 2011]",
    author: "מרגרט אטווד",
    buildDb: () => ({
      editions: [edition({
        simania_id: 956502,
        title: "עין החתול [מהדורת 2011]",
        author: "מרגרט אטווד",
      })],
    }),
    check: expectHardcover(94555),
  },
  {
    simania_id: 1027968,
    title: "הקולגה",
    author: "פרידה מקפדן",
    buildDb: () => ({
      editions: [edition({
        simania_id: 1027968,
        title: "הקולגה",
        author: "פרידה מקפדן",
      })],
    }),
    check: (row, work) => {
      if (row.resolve_status !== "not_found") {
        return { ok: false, detail: `expected not_found, got ${row.resolve_status}` };
      }
      if (row.work_id !== null || work !== null) {
        return { ok: false, detail: "expected no linked work" };
      }
      return { ok: true, detail: "" };
    },
  },
  {
    simania_id: 34027,
    title: "נערה בנוף",
    author: "ג'ונתן לת'ם",
    buildDb: () => ({
      editions: [edition({
        simania_id: 34027,
        title: "נערה בנוף",
        author: "ג'ונתן לת'ם",
      })],
    }),
    check: (row, work) => {
      if (row.resolve_status === "not_found" && row.work_id === null) {
        return { ok: true, detail: "" };
      }
      const hardcoverId = work?.hardcover_id;
      if (hardcoverId === 473787) return { ok: true, detail: "" };
      if (hardcoverId === 483014) {
        return { ok: false, detail: "wrong book 483014" };
      }
      return {
        ok: false,
        detail: `expected not_found or 473787, got ${row.resolve_status} ${hardcoverId ?? "null"}`,
      };
    },
  },
  {
    simania_id: 1013521,
    title: "כיבוי אורות",
    author: "דיוויד קופ",
    buildDb: () => ({
      editions: [edition({
        simania_id: 1013521,
        title: "כיבוי אורות",
        author: "דיוויד קופ",
      })],
    }),
    check: (row, work) => {
      if (row.resolve_status === "not_found" && row.work_id === null) {
        return { ok: true, detail: "" };
      }
      const hardcoverId = work?.hardcover_id;
      if (hardcoverId === 559469) return { ok: true, detail: "" };
      if (hardcoverId === 372879) {
        return { ok: false, detail: "wrong book 372879" };
      }
      return {
        ok: false,
        detail: `expected not_found or 559469, got ${row.resolve_status} ${hardcoverId ?? "null"}`,
      };
    },
  },
];

function workForEdition(
  db: FakeDb,
  row: EditionRow,
): Record<string, unknown> | null {
  if (!row.work_id) return null;
  return db.tables.works?.find((candidate) => candidate.id === row.work_id) ??
    null;
}

function formatLine(
  pass: boolean,
  title: string,
  row: EditionRow,
  work: Record<string, unknown> | null,
  suffix = "",
): string {
  const hardcoverId = work?.hardcover_id ?? "—";
  const hardcoverTitle = work?.original_title ?? "—";
  const flag = pass ? "PASS" : "FAIL";
  const extra = suffix ? ` (${suffix})` : "";
  return `${flag} ${title} ${row.resolve_status} ${hardcoverId} ${hardcoverTitle}${extra}`;
}

async function resolveCase(spec: CaseSpec): Promise<string> {
  const db = new FakeDb(spec.buildDb());
  let current = db.tables.editions!.find((row) =>
    row.simania_id === spec.simania_id
  ) as EditionRow;

  let result = await ensureResolved(db, current, { now: () => NOW });
  if (result.resolve_status === "pending") {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await ensureResolved(db, result, { now: () => NOW });
  }

  const work = workForEdition(db, result);
  if (result.resolve_status === "pending") {
    return formatLine(false, spec.title, result, work, "provider failure");
  }

  const verdict = spec.check(result, work);
  return formatLine(verdict.ok, spec.title, result, work, verdict.detail);
}

loadHardcoverApiKey();

let failed = false;
for (const spec of CASES) {
  const line = await resolveCase(spec);
  console.log(line);
  if (line.startsWith("FAIL")) failed = true;
}

Deno.exit(failed ? 1 : 0);
