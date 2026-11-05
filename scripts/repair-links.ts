import type { Sql } from "npm:postgres@3.4.5";
import {
  authors,
  type HardcoverBook,
} from "../supabase/functions/_shared/hardcover.ts";
import { type LinkProposal, proposeLink } from "./lib/link-proposal.ts";
import { nameSoundScore } from "./lib/names.ts";
import {
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

export type RepairPlan =
  & Omit<LinkProposal, "book" | "original_title" | "reason">
  & {
    title: string;
    author: string | null;
    translator: string | null;
    original_title: string;
    book: HardcoverBook;
    reason: "ok";
  };

export interface PlanRepairDeps {
  sql: Sql;
  shelvedUnlinkedEditions?: (sql: Sql) => Promise<RepairEdition[]>;
  proposeLink?: (
    edition: RepairEdition,
  ) => Promise<LinkProposal>;
  report?: (edition: RepairEdition, proposal: LinkProposal) => void;
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
      title: edition.title,
      author: edition.author,
      translator: edition.translator ?? null,
      original_title: proposal.original_title,
      book: proposal.book,
      reason: "ok",
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
        ${plan.book.id},
        ${plan.book.title},
        ${authors(plan.book)},
        ${plan.book.cached_similar_book_ids ?? []},
        ${JSON.stringify(cachedTags(plan.book))}::jsonb,
        ${coverUrl(plan.book)},
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

    const editions = await tx<{ simania_id: number }[]>`
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

function printPlan(plan: RepairPlan, log: (message: string) => void): void {
  const evidence = plan.english_author === null
    ? { sound_score: nameSoundScore(plan.author ?? "", authors(plan.book)) }
    : { english_author: plan.english_author };
  log(JSON.stringify({
    simania_id: plan.simania_id,
    title: plan.title,
    original_title: plan.original_title,
    hardcover_id: plan.book.id,
    hardcover_title: plan.book.title,
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
