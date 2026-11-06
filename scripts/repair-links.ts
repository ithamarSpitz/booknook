import type { Sql } from "npm:postgres@3.4.5";
import {
  authors,
  type HardcoverBook,
} from "../supabase/functions/_shared/hardcover.ts";
import { type LinkProposal, proposeLink } from "./lib/link-proposal.ts";
import { nameSoundScore } from "./lib/names.ts";
import {
  type AuthorMismatchFinding,
  findAuthorMismatches,
  type LinkedEdition,
} from "./audit-catalog.ts";
import {
  linkedEditionsWithWorks,
  loadOperatorEnv,
  openProdDb,
  shelvedUnlinkedEditions,
} from "./lib/prod-db.ts";

export interface RepairEdition {
  simania_id: number;
  title: string;
  author: string | null;
  translator?: string | null;
}

type AcceptedProposal = LinkProposal & {
  original_title: string;
  book: HardcoverBook;
  reason: "ok";
};

export type LinkRepairPlan =
  & Omit<LinkProposal, "book" | "original_title" | "reason">
  & {
    kind: "link";
    title: string;
    author: string | null;
    translator: string | null;
    original_title: string;
    book: HardcoverBook;
    reason: "ok";
  };

export type RelinkRepairPlan = Omit<LinkedEdition, "work_id"> & {
  kind: "relink";
  work_id: string;
  book: HardcoverBook;
  proposal: AcceptedProposal;
};

export type RepairPlan = LinkRepairPlan | RelinkRepairPlan;

export interface PlanRepairDeps {
  sql: Sql;
  shelvedUnlinkedEditions?: (sql: Sql) => Promise<RepairEdition[]>;
  linkedEditionsWithWorks?: (sql: Sql) => Promise<LinkedEdition[]>;
  proposeLink?: (
    edition: RepairEdition,
  ) => Promise<LinkProposal>;
  findAuthorMismatches?: (
    editions: LinkedEdition[],
  ) => Promise<AuthorMismatchFinding[]>;
  report?: (edition: RepairEdition, proposal: LinkProposal) => void;
  reportMismatch?: (finding: AuthorMismatchFinding) => void;
}

/** Build actionable repairs in stable edition order; non-actions are reported. */
export async function planRepairs(
  deps: PlanRepairDeps,
): Promise<RepairPlan[]> {
  const list = deps.shelvedUnlinkedEditions ??
    (shelvedUnlinkedEditions as unknown as (
      sql: Sql,
    ) => Promise<RepairEdition[]>);
  const propose = deps.proposeLink ?? proposeLink;
  const report = deps.report ?? reportRejectedProposal;
  const editions = await list(deps.sql);
  const plans: RepairPlan[] = [];

  // Deliberately sequential: this bounds provider traffic and preserves output order.
  for (const edition of editions) {
    const proposal = await propose(edition);
    if (
      proposal.reason !== "ok" || proposal.book === null ||
      proposal.original_title === null
    ) {
      report(edition, proposal);
      continue;
    }
    plans.push({
      ...proposal,
      kind: "link",
      title: edition.title,
      author: edition.author,
      translator: edition.translator ?? null,
      original_title: proposal.original_title,
      book: proposal.book,
      reason: "ok",
    });
  }

  const listLinked = deps.linkedEditionsWithWorks ??
    (linkedEditionsWithWorks as unknown as (
      sql: Sql,
    ) => Promise<LinkedEdition[]>);
  const findMismatches = deps.findAuthorMismatches ?? findAuthorMismatches;
  const reportMismatch = deps.reportMismatch ?? reportUnrepairableMismatch;
  const mismatches = await findMismatches(await listLinked(deps.sql));

  for (const finding of mismatches) {
    const proposal = finding.proposal;
    if (
      finding.work_id === undefined || proposal?.reason !== "ok" ||
      proposal.book === null || proposal.original_title === null ||
      proposal.book.id === finding.hardcover_id
    ) {
      reportMismatch(finding);
      continue;
    }
    plans.push({
      kind: "relink",
      simania_id: finding.simania_id,
      work_id: finding.work_id,
      title: finding.title,
      author: finding.author,
      hardcover_id: finding.hardcover_id,
      original_title: finding.original_title,
      original_authors: finding.original_authors,
      book: proposal.book,
      proposal: proposal as AcceptedProposal,
    });
  }

  return plans;
}

export interface RepairResult {
  simania_id: number;
  status: "linked" | "skipped";
  work_id: string;
}

function cachedTags(book: HardcoverBook): Record<string, unknown[]> {
  const value = book.cached_tags;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const valid: Record<string, unknown[]> = {};
  for (const [category, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    valid[category] = entries.filter((entry) =>
      Boolean(
        entry && typeof entry === "object" &&
          typeof (entry as { tag?: unknown }).tag === "string" &&
          (entry as { tag: string }).tag.trim(),
      )
    );
  }
  return valid;
}

function coverUrl(book: HardcoverBook): string | null {
  const candidate = book as unknown as Record<string, unknown>;
  for (const key of ["cover_url", "image_url"]) {
    if (typeof candidate[key] === "string") return candidate[key];
  }
  return book.image?.url ?? null;
}

/** Apply one repair atomically, without ever replacing an existing edition link. */
export async function applyRepair(
  sql: Sql,
  plan: RepairPlan,
  now: Date,
): Promise<RepairResult> {
  return await sql.begin(async (tx) => {
    const proposal = plan.kind === "relink" ? plan.proposal : plan;
    const works = await tx<{ id: string }[]>`
      insert into public.works (
        hardcover_id,
        original_title,
        original_authors,
        similar_ids,
        tags,
        hardcover_cover_url,
        refreshed_at
      ) values (
        ${proposal.book.id},
        ${proposal.book.title},
        ${authors(proposal.book)},
        ${proposal.book.cached_similar_book_ids ?? []},
        ${JSON.stringify(cachedTags(proposal.book))}::jsonb,
        ${coverUrl(proposal.book)},
        ${now}
      )
      on conflict (hardcover_id) do update set
        original_title = excluded.original_title,
        original_authors = excluded.original_authors,
        similar_ids = excluded.similar_ids,
        tags = excluded.tags,
        hardcover_cover_url = excluded.hardcover_cover_url,
        refreshed_at = excluded.refreshed_at
      returning id
    `;
    const workId = works[0]?.id;
    if (!workId) throw new Error("Work upsert returned no id.");

    const editions = plan.kind === "relink"
      ? await tx<{ simania_id: number }[]>`
        update public.editions
        set
          work_id = ${workId},
          resolve_status = 'original_title',
          resolved_at = ${now}
        where simania_id = ${plan.simania_id}
          and work_id = ${plan.work_id}
        returning simania_id
      `
      : await tx<{ simania_id: number }[]>`
        update public.editions
        set
          work_id = ${workId},
          resolve_status = 'original_title',
          resolved_at = ${now}
        where simania_id = ${plan.simania_id}
          and work_id is null
        returning simania_id
      `;

    return {
      simania_id: plan.simania_id,
      status: editions.length === 0 ? "skipped" : "linked",
      work_id: workId,
    };
  });
}

interface RunDeps {
  loadOperatorEnv: typeof loadOperatorEnv;
  openProdDb: typeof openProdDb;
  planRepairs: typeof planRepairs;
  applyRepair: typeof applyRepair;
  now: () => Date;
  log: (message: string) => void;
}

const runDefaults: RunDeps = {
  loadOperatorEnv,
  openProdDb,
  planRepairs,
  applyRepair,
  now: () => new Date(),
  log: console.log,
};

/** Run the CLI and return its exit code. Exported for a database-free CLI test. */
export async function runRepairLinks(
  args: string[] = Deno.args,
  overrides: Partial<RunDeps> = {},
): Promise<number> {
  const deps = { ...runDefaults, ...overrides };
  const apply = args.includes("--apply");
  deps.loadOperatorEnv();
  const sql = await deps.openProdDb({ readOnly: !apply });

  try {
    const plans = await deps.planRepairs({ sql });
    for (const plan of plans) printPlan(plan, deps.log);
    if (!apply) return 0;

    let failed = false;
    for (const plan of plans) {
      try {
        const result = await deps.applyRepair(sql, plan, deps.now());
        deps.log(JSON.stringify(result));
      } catch (error) {
        failed = true;
        deps.log(JSON.stringify({
          simania_id: plan.simania_id,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        }));
      }
    }
    return failed ? 1 : 0;
  } finally {
    await sql.end();
  }
}

function reportRejectedProposal(
  edition: RepairEdition,
  proposal: LinkProposal,
): void {
  console.log(JSON.stringify({
    simania_id: edition.simania_id,
    title: edition.title,
    reason: proposal.reason,
  }));
}

function reportUnrepairableMismatch(finding: AuthorMismatchFinding): void {
  console.log(JSON.stringify({
    kind: "relink",
    simania_id: finding.simania_id,
    title: finding.title,
    hardcover_id: finding.hardcover_id,
    reason: finding.reason,
  }));
}

function printPlan(plan: RepairPlan, log: (message: string) => void): void {
  const proposal = plan.kind === "relink" ? plan.proposal : plan;
  const evidence = proposal.english_author === null
    ? {
      sound_score: nameSoundScore(
        plan.author ?? "",
        authors(proposal.book),
      ),
    }
    : { english_author: proposal.english_author };
  if (plan.kind === "relink") {
    log(JSON.stringify({
      kind: "relink",
      simania_id: plan.simania_id,
      title: plan.title,
      from: {
        hardcover_id: plan.hardcover_id,
        title: plan.original_title,
      },
      to: {
        hardcover_id: proposal.book.id,
        title: proposal.book.title,
      },
      evidence,
    }));
    return;
  }
  log(JSON.stringify({
    kind: "link",
    simania_id: plan.simania_id,
    title: plan.title,
    original_title: plan.original_title,
    hardcover_id: proposal.book.id,
    hardcover_title: proposal.book.title,
    evidence,
  }));
}

if (import.meta.main) {
  try {
    Deno.exit(await runRepairLinks());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Repair failed.");
    Deno.exit(1);
  }
}
