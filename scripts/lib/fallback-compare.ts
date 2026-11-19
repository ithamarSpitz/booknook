import {
  type HebrewCandidate,
  originalYearOf,
} from "../../supabase/functions/_shared/hebrew-candidates.ts";

export type FallbackDecision = {
  simania_id: number | null;
  rule: string | null;
};

type JsonLine = Record<string, unknown>;

type CandidateResult = {
  candidates: HebrewCandidate[];
  english_names: string[];
};

export function buildFallbackCandidatesResponse(
  workId: string,
  result: CandidateResult,
  book: { release_year?: unknown } | null | undefined,
) {
  return {
    work_id: workId,
    ...result,
    original_year: originalYearOf(book),
  };
}

export type FallbackChange = {
  key: string;
  before: FallbackDecision;
  after: FallbackDecision;
};

export type FallbackComparison = {
  changes: FallbackChange[];
  unverified: string[];
  onlyBefore: string[];
  onlyAfter: string[];
  lostLinks: string[];
  exitCode: 0 | 1;
  counts: {
    changes: number;
    lost_links: number;
    unverified: number;
    only_before: number;
    only_after: number;
  };
};

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function lineKey(line: JsonLine): string {
  const hardcoverId = positiveInteger(line.hardcover_id);
  if (hardcoverId != null) return String(hardcoverId);
  if (typeof line.title === "string" && typeof line.author === "string") {
    return `${line.title}|${line.author}`;
  }
  throw new Error(
    "Fallback line has neither hardcover_id nor title and author.",
  );
}

function parseRun(text: string): Map<string, JsonLine> {
  const rows = new Map<string, JsonLine>();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const line = value as JsonLine;
    if ("totals" in line) continue;
    const key = lineKey(line);
    if (rows.has(key)) throw new Error(`Duplicate fallback key: ${key}`);
    rows.set(key, line);
  }
  return rows;
}

function decision(line: JsonLine): FallbackDecision {
  return {
    simania_id: positiveInteger(line.simania_id),
    rule: typeof line.rule === "string" ? line.rule : null,
  };
}

function hasErrors(line: JsonLine | undefined): boolean {
  if (!line || !("errors" in line)) return false;
  return Array.isArray(line.errors)
    ? line.errors.length > 0
    : Boolean(line.errors);
}

function linkedIds(line: JsonLine): Set<number> {
  if (!Array.isArray(line.linked)) return new Set();
  return new Set(
    line.linked.map((item) => {
      if (!item || typeof item !== "object") return null;
      return positiveInteger((item as JsonLine).simania_id);
    }).filter((id): id is number => id != null),
  );
}

export function compareFallbackRuns(
  beforeText: string,
  afterText: string,
  keep: ReadonlySet<string> = new Set(),
): FallbackComparison {
  const beforeRows = parseRun(beforeText);
  const afterRows = parseRun(afterText);
  const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  const changes: FallbackChange[] = [];
  const unverified: string[] = [];
  const onlyBefore: string[] = [];
  const onlyAfter: string[] = [];
  const lostLinks: string[] = [];

  for (const key of keys) {
    const beforeLine = beforeRows.get(key);
    const afterLine = afterRows.get(key);
    if (hasErrors(beforeLine) || hasErrors(afterLine)) unverified.push(key);
    if (!beforeLine) {
      onlyAfter.push(key);
      continue;
    }
    if (!afterLine) {
      onlyBefore.push(key);
      continue;
    }
    if (hasErrors(beforeLine) || hasErrors(afterLine)) continue;

    const before = decision(beforeLine);
    const after = decision(afterLine);
    if (
      before.simania_id === after.simania_id && before.rule === after.rule
    ) continue;

    changes.push({ key, before, after });
    const protectedBefore = before.simania_id != null &&
      (linkedIds(beforeLine).has(before.simania_id) || keep.has(key));
    if (protectedBefore && after.simania_id !== before.simania_id) {
      lostLinks.push(key);
    }
  }

  return {
    changes,
    unverified,
    onlyBefore,
    onlyAfter,
    lostLinks,
    exitCode: lostLinks.length ? 1 : 0,
    counts: {
      changes: changes.length,
      lost_links: lostLinks.length,
      unverified: unverified.length,
      only_before: onlyBefore.length,
      only_after: onlyAfter.length,
    },
  };
}

function containsWikidata429(value: unknown): boolean {
  if (typeof value === "string") return value.includes("Wikidata HTTP 429");
  if (value instanceof Error) return containsWikidata429(value.message);
  if (!value || typeof value !== "object") return false;
  const result = value as { providerErrors?: unknown; errors?: unknown };
  return [result.providerErrors, result.errors].some((errors) =>
    Array.isArray(errors) && errors.some(containsWikidata429)
  );
}

export async function retryWikidata429<T>(
  decide: () => Promise<T>,
  wait: () => Promise<void>,
  maxRetries = 3,
): Promise<T> {
  for (let retry = 0;; retry++) {
    try {
      const result = await decide();
      if (!containsWikidata429(result) || retry >= maxRetries) return result;
    } catch (error) {
      if (!containsWikidata429(error) || retry >= maxRetries) throw error;
    }
    await wait();
  }
}
