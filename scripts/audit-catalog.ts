import type { Sql } from "npm:postgres@3.4.5";
import { wikidataEnglishAuthor } from "../supabase/functions/_shared/bridges.ts";
import {
  type HardcoverBook,
  hardcoverBooks,
} from "../supabase/functions/_shared/hardcover.ts";
import { similarity } from "../supabase/functions/_shared/utils.ts";
import { FakeDb } from "../tests/functions/helpers/fake-db.ts";
import { type LinkProposal, proposeLink } from "./lib/link-proposal.ts";
import { localizeChain } from "./lib/localize-chain.ts";
import { nameSoundScore } from "./lib/names.ts";
import {
  englishOnlyRecommendations,
  linkedEditionsWithWorks,
  loadOperatorEnv,
  openProdDb,
  shelvedUnlinkedEditions,
} from "./lib/prod-db.ts";

export interface EnglishOnlyRecommendation {
  display_name: string;
  work_id: string;
  hardcover_id: number;
  original_title: string;
  original_authors: string[];
}

export interface LinkedEdition {
  simania_id: number;
  title: string;
  author: string | null;
  hardcover_id: number;
  original_title: string;
  original_authors: string[];
}

export interface UnlinkedEdition {
  simania_id: number;
  title: string;
  author: string | null;
  translator?: string | null;
}

export interface LocalizedEdition {
  simania_id: number;
  title: string;
}

export interface EnglishOnlyFinding {
  display_name: string;
  hardcover_id: number;
  english_title: string;
  simania_id: number | null;
  hebrew_title: string | null;
  error?: "provider_error";
}

export interface AuthorMismatchFinding {
  simania_id: number;
  hebrew_title: string;
  hebrew_author: string | null;
  hardcover_id: number;
  english_title: string;
  english_authors: string[];
  error?: "provider_error";
}

export interface UnlinkedFinding extends UnlinkedEdition {
  proposal: LinkProposal | null;
  reason: LinkProposal["reason"];
  error?: "provider_error";
}

export interface AuditReport {
  english_only_with_hebrew: EnglishOnlyFinding[];
  author_mismatches: AuthorMismatchFinding[];
  unlinked: UnlinkedFinding[];
}

type Query<T> = (sql: Sql | undefined) => PromiseLike<T[]>;

export interface AuditDeps {
  sql?: Sql;
  englishOnlyRecommendations?: Query<EnglishOnlyRecommendation>;
  linkedEditionsWithWorks?: Query<LinkedEdition>;
  shelvedUnlinkedEditions?: Query<UnlinkedEdition>;
  localize?: (
    recommendation: EnglishOnlyRecommendation,
  ) => Promise<LocalizedEdition | null>;
  proposeLink?: typeof proposeLink;
  wikidataEnglishAuthor?: (name: string) => Promise<string | null>;
  nameSoundScore?: (hebrewName: string, latinNames: string[]) => number;
  similarity?: (left: string, right: string) => number;
}

function errorFinding(
  recommendation: EnglishOnlyRecommendation,
): EnglishOnlyFinding {
  return {
    display_name: recommendation.display_name,
    hardcover_id: recommendation.hardcover_id,
    english_title: recommendation.original_title,
    simania_id: null,
    hebrew_title: null,
    error: "provider_error",
  };
}

async function defaultLocalize(
  recommendation: EnglishOnlyRecommendation,
): Promise<LocalizedEdition | null> {
  const books = await hardcoverBooks([recommendation.hardcover_id]);
  const book = books[0] as HardcoverBook | undefined;
  if (!book) throw new Error("Hardcover book unavailable");

  const db = new FakeDb();
  const localized = await localizeChain(db, recommendation.hardcover_id, book);
  if (localized.simaniaId === null) {
    const providerFailed = (db.tables.editions ?? []).some((row) =>
      row.resolve_status === "pending"
    );
    if (providerFailed) throw new Error("Localization provider failed");
    return null;
  }

  if (localized.title === null) {
    throw new Error("Localized edition title unavailable");
  }
  return {
    simania_id: localized.simaniaId,
    title: localized.title,
  };
}

function mismatchFinding(edition: LinkedEdition): AuthorMismatchFinding {
  return {
    simania_id: edition.simania_id,
    hebrew_title: edition.title,
    hebrew_author: edition.author,
    hardcover_id: edition.hardcover_id,
    english_title: edition.original_title,
    english_authors: edition.original_authors,
  };
}

function requiredSql(sql: Sql | undefined): Sql {
  if (sql === undefined) throw new Error("Database connection is missing");
  return sql;
}

export async function runAudit(deps: AuditDeps = {}): Promise<AuditReport> {
  const localize = deps.localize ?? defaultLocalize;
  const makeProposal = deps.proposeLink ?? proposeLink;
  const englishAuthor = deps.wikidataEnglishAuthor ?? wikidataEnglishAuthor;
  const soundScore = deps.nameSoundScore ?? nameSoundScore;
  const compare = deps.similarity ?? similarity;

  // Query failures are deliberately not caught: a database failure stops the run.
  const recommendations: EnglishOnlyRecommendation[] = deps
      .englishOnlyRecommendations
    ? await deps.englishOnlyRecommendations(deps.sql)
    : await englishOnlyRecommendations(
      requiredSql(deps.sql),
    ) as unknown as EnglishOnlyRecommendation[];
  const linked: LinkedEdition[] = deps.linkedEditionsWithWorks
    ? await deps.linkedEditionsWithWorks(deps.sql)
    : await linkedEditionsWithWorks(
      requiredSql(deps.sql),
    ) as unknown as LinkedEdition[];
  const unlinkedEditions: UnlinkedEdition[] = deps.shelvedUnlinkedEditions
    ? await deps.shelvedUnlinkedEditions(deps.sql)
    : await shelvedUnlinkedEditions(
      requiredSql(deps.sql),
    ) as unknown as UnlinkedEdition[];

  const englishFindings: EnglishOnlyFinding[] = [];
  // Keep provider work sequential: Simania and Wikidata are rate limited.
  for (const recommendation of recommendations) {
    try {
      const localized = await localize(recommendation);
      if (localized !== null) {
        englishFindings.push({
          display_name: recommendation.display_name,
          hardcover_id: recommendation.hardcover_id,
          english_title: recommendation.original_title,
          simania_id: localized.simania_id,
          hebrew_title: localized.title,
        });
      }
    } catch {
      englishFindings.push(errorFinding(recommendation));
    }
  }

  const mismatches: AuthorMismatchFinding[] = [];
  for (const edition of linked) {
    if (soundScore(edition.author ?? "", edition.original_authors) >= 0.5) {
      continue;
    }

    try {
      const translated = await englishAuthor(edition.author ?? "");
      const authorMatches = translated !== null &&
        edition.original_authors.some((author) =>
          compare(translated, author) > 0.45
        );
      if (!authorMatches) mismatches.push(mismatchFinding(edition));
    } catch {
      mismatches.push({ ...mismatchFinding(edition), error: "provider_error" });
    }
  }

  const unlinked: UnlinkedFinding[] = [];
  for (const edition of unlinkedEditions) {
    try {
      const proposal = await makeProposal(edition);
      unlinked.push({
        ...edition,
        proposal,
        reason: proposal.reason,
        ...(proposal.reason === "provider_error"
          ? { error: "provider_error" as const }
          : {}),
      });
    } catch {
      unlinked.push({
        ...edition,
        proposal: null,
        reason: "provider_error",
        error: "provider_error",
      });
    }
  }

  return {
    english_only_with_hebrew: englishFindings,
    author_mismatches: mismatches,
    unlinked,
  };
}

export function formatAudit(report: AuditReport, json = false): string {
  if (json) return JSON.stringify(report);

  const lines: string[] = ["english_only_with_hebrew"];
  for (const row of report.english_only_with_hebrew) {
    lines.push(
      row.error
        ? `  ${row.display_name} | Hardcover ${row.hardcover_id} | ${row.english_title} | error: ${row.error}`
        : `  ${row.display_name} | Hardcover ${row.hardcover_id} | ${row.english_title} -> Simania ${row.simania_id} | ${row.hebrew_title}`,
    );
  }
  if (report.english_only_with_hebrew.length === 0) lines.push("  (none)");

  lines.push("author_mismatches");
  for (const row of report.author_mismatches) {
    lines.push(
      `  Simania ${row.simania_id} | ${row.hebrew_title} | ${
        row.hebrew_author ?? "(no author)"
      } | Hardcover ${row.hardcover_id} | ${row.english_title} | ${
        row.english_authors.join(", ")
      }${row.error ? ` | error: ${row.error}` : ""}`,
    );
  }
  if (report.author_mismatches.length === 0) lines.push("  (none)");

  lines.push("unlinked");
  for (const row of report.unlinked) {
    const proposed = row.proposal?.book === null || row.proposal === null
      ? row.reason
      : `Hardcover ${row.proposal.book.id} | ${row.proposal.book.title}`;
    lines.push(
      `  Simania ${row.simania_id} | ${row.title} | ${
        row.author ?? "(no author)"
      } | ${proposed}${row.error ? ` | error: ${row.error}` : ""}`,
    );
  }
  if (report.unlinked.length === 0) lines.push("  (none)");
  return lines.join("\n");
}

async function main(): Promise<void> {
  let sql: Sql | undefined;
  try {
    loadOperatorEnv();
    sql = await openProdDb({ readOnly: true });
    const report = await runAudit({ sql });
    console.log(formatAudit(report, Deno.args.includes("--json")));
  } catch {
    console.error(
      "Catalog audit failed before all sections could be completed.",
    );
    Deno.exitCode = 2;
  } finally {
    if (sql !== undefined) {
      try {
        await sql.end();
      } catch {
        console.error("Catalog audit database connection could not be closed.");
        Deno.exitCode = 2;
      }
    }
  }
}

if (import.meta.main) await main();
