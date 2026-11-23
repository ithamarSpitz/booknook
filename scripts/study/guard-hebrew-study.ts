import { resolveMatch } from "../../supabase/functions/_shared/catalog.ts";
import {
  authors,
  findHardcoverBook,
  hardcoverBooks,
  searchHardcoverBooks,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import { authorGuardRejects } from "../../supabase/functions/_shared/fallback-match.ts";
import type { EditionRow } from "../../supabase/functions/_shared/types.ts";
import { normalize } from "../../supabase/functions/_shared/utils.ts";
import { openProdDb } from "../lib/prod-db.ts";
import { serviceCatalogDb } from "../recheck-links.ts";
import { independentCheck } from "./hebrew-dictionary-study.ts";

const SOURCE = "tasks/sprint-46-hebrew-gaps/data/heb-explain.jsonl";
const REPORT = "docs/reports/2026-11-23-guard-hebrew-study.md";

type ExplainLine = {
  simania_id: number;
  explain: {
    english_author?: { name?: string } | null;
    hardcover_queries?: Array<{ best_title?: string | null }>;
    stop?: string;
  };
};

type Result = {
  simaniaId: number;
  hebrew: string;
  hebrewAuthor: string;
  english: string | null;
  englishAuthors: string[];
  wikidata: string | null;
  score: number | null;
  verdict: "right" | "wrong" | "unknown";
};

function objectsIn(line: string): ExplainLine[] {
  const objects: ExplainLine[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth++ === 0) start = i;
    } else if (char === "}" && --depth === 0 && start >= 0) {
      try {
        objects.push(JSON.parse(line.slice(start, i + 1)));
      } catch {
        // Ignore incomplete provider output; only complete top-level records count.
      }
      start = -1;
    }
  }
  return objects;
}

function guardLines(text: string): ExplainLine[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const stop = line.lastIndexOf('"stop":"guard_rejected"');
    if (stop < 0) return [];
    const matches = objectsIn(line).filter((item) =>
      item.explain?.stop === "guard_rejected"
    );
    if (matches.length > 0) return [matches.at(-1)!];

    // Some captured lines contain an interrupted JSON object followed by a
    // second object. Recover the record immediately preceding the stop marker.
    const prefix = line.slice(0, stop);
    const start = prefix.lastIndexOf('{"simania_id":');
    const fragment = start >= 0 ? prefix.slice(start) : prefix;
    const id = fragment.match(/^\{"simania_id":(\d+)/)?.[1];
    if (!id) return [];
    const bestTitles = [
      ...fragment.matchAll(/"best_title":"((?:\\.|[^"\\])*)"/g),
    ];
    const author = [
      ...fragment.matchAll(/"english_author":\{"name":"((?:\\.|[^"\\])*)"/g),
    ]
      .at(-1)?.[1];
    return [{
      simania_id: Number(id),
      explain: {
        english_author: author ? { name: JSON.parse(`"${author}"`) } : null,
        hardcover_queries: bestTitles.map((match) => ({
          best_title: JSON.parse(`"${match[1]}"`),
        })),
        stop: "guard_rejected",
      },
    }];
  });
}

function escapeCell(value: string | null): string {
  return (value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function render(results: Result[]): string {
  const right = results.filter((row) => row.verdict === "right").length;
  const wrong = results.filter((row) => row.verdict === "wrong").length;
  const unknown = results.filter((row) => row.verdict === "unknown").length;
  return [
    `checked: ${results.length}`,
    `right: ${right}`,
    `wrong: ${wrong}`,
    `unknown: ${unknown}`,
    "",
    "| Simania ID | Hebrew title | Hebrew author | Rejected English title | English author(s) | Wikidata Hebrew label | similarity | verdict |",
    "|---:|---|---|---|---|---|---:|---|",
    ...results.map((row) =>
      `| ${row.simaniaId} | ${escapeCell(row.hebrew)} | ${
        escapeCell(row.hebrewAuthor)
      } | ${escapeCell(row.english)} | ${
        escapeCell(row.englishAuthors.join(", "))
      } | ${escapeCell(row.wikidata)} | ${
        row.score === null ? "—" : row.score.toFixed(2)
      } | ${row.verdict} |`
    ),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const lines = guardLines(await Deno.readTextFile(SOURCE));
  if (lines.length !== 35) {
    throw new Error(`Expected 35 guard_rejected lines, found ${lines.length}`);
  }
  const ids = [...new Set(lines.map((line) => line.simania_id))];
  const sql = await openProdDb({ readOnly: true });
  try {
    const editions = await sql<EditionRow[]>`
      select simania_id, work_id, resolve_status, resolved_at, title, author,
        translator, publisher, series, category, year, pages, description,
        cover_url, simania_rating, simania_rating_count, details_at
      from public.editions
      where simania_id = any(${ids}::integer[])
    `;
    const byId = new Map(
      editions.map((edition) => [edition.simania_id, edition]),
    );
    const candidateCache = new Map<number, Promise<HardcoverBook | null>>();
    const findRejected = (line: ExplainLine): Promise<HardcoverBook | null> => {
      let answer = candidateCache.get(line.simania_id);
      if (answer) return answer;
      answer = (async () => {
        const edition = byId.get(line.simania_id);
        if (!edition) return null;
        const rejectedCandidates: HardcoverBook[] = [];
        await resolveMatch(serviceCatalogDb(sql), edition, {
          findHardcoverBook: async (...args) => {
            const book = await findHardcoverBook(...args);
            if (
              book &&
              authorGuardRejects(edition.author, authors(book), "")
            ) {
              rejectedCandidates.push(book);
            }
            return book;
          },
        });
        const rejected = rejectedCandidates.at(-1);
        if (rejected) return rejected;
        const bestTitle = line.explain.hardcover_queries?.map((query) =>
          query.best_title
        ).findLast((title): title is string => Boolean(title?.trim()));
        if (!bestTitle) return null;
        const books = await hardcoverBooks(
          await searchHardcoverBooks(bestTitle),
        );
        return books.find((book) =>
          normalize(book.title) === normalize(bestTitle)
        ) ?? null;
      })();
      candidateCache.set(line.simania_id, answer);
      return answer;
    };

    const results: Result[] = [];
    for (const [index, line] of lines.entries()) {
      const edition = byId.get(line.simania_id);
      const book = await findRejected(line);
      const englishAuthors = book ? authors(book) : [];
      const checked = edition && book
        ? await independentCheck(
          edition.title,
          edition.author ?? "",
          book.title,
          englishAuthors,
        )
        : { wikidata: null, score: null, verdict: "unknown" as const };
      results.push({
        simaniaId: line.simania_id,
        hebrew: edition?.title ?? "",
        hebrewAuthor: edition?.author ?? "",
        english: book?.title ?? null,
        englishAuthors,
        ...checked,
      });
      console.error(`processed ${index + 1}/${lines.length}`);
    }
    await Deno.writeTextFile(REPORT, render(results));
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
