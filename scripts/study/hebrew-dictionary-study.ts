import { wiktionaryGlosses } from "../../supabase/functions/_shared/bridges.ts";
import {
  authors,
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import {
  normalize,
  similarity,
} from "../../supabase/functions/_shared/utils.ts";
import { sameAuthor } from "../../supabase/functions/_shared/author-sound.ts";
import { dictionaryVerdict, wordForms } from "../lib/dictionary.ts";
import { hardcoverDailyRemaining } from "../lib/hardcover-budget.ts";
import { openProdDb } from "../lib/prod-db.ts";
import { throttledWikimediaFetch } from "../measure-links.ts";

const REPORT = "docs/reports/2026-11-23-hebrew-dictionary-study.md";
const MIN_HARDCOVER_REMAINING = 800;
const MAX_HARDCOVER_CALLS = 400;
const HARDCOVER_GAP_MS = 1_000;

type Edition = {
  simania_id: number;
  title: string;
  author: string | null;
};

type Found = {
  hebrew: string;
  english: string;
  author: string;
  dictionaryEnglish: number;
  dictionaryHebrew: number;
  contradicted: number;
  accepted: boolean;
  wikidata: string | null;
  score: number | null;
  verdict: "right" | "wrong" | "unknown";
};

export type IndependentVerdict = Pick<
  Found,
  "wikidata" | "score" | "verdict"
>;

class StudyStopped extends Error {}

const nativeFetch = globalThis.fetch.bind(globalThis);
let hardcoverCalls = 0;
let hardcoverRemaining: number | null = null;
let hardcoverTail: Promise<void> = Promise.resolve();
let lastHardcoverStart = 0;
let studyFetchInstalled = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hardcoverFetch(
  input: string | URL | Request,
  init?: RequestInit,
) {
  let release!: () => void;
  const previous = hardcoverTail;
  hardcoverTail = new Promise<void>((resolve) => release = resolve);
  await previous;
  try {
    for (let attempt = 0; attempt < 7; attempt++) {
      if (hardcoverCalls >= MAX_HARDCOVER_CALLS) {
        throw new StudyStopped("Hardcover call limit reached");
      }
      const wait = HARDCOVER_GAP_MS - (Date.now() - lastHardcoverStart);
      if (wait > 0) await sleep(wait);
      lastHardcoverStart = Date.now();
      hardcoverCalls++;
      const response = await nativeFetch(input, init);
      const raw = response.headers.get("x-ratelimit-daily-remaining");
      if (raw !== null && /^\d+$/.test(raw.trim())) {
        hardcoverRemaining = Number(raw);
      }
      if (response.status !== 429 || attempt === 6) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await sleep(Math.max(1_000, (retryAfter > 0 ? retryAfter : 15) * 1_000));
    }
    throw new StudyStopped("Hardcover retry limit reached");
  } finally {
    release();
  }
}

export function installStudyFetch(): void {
  if (studyFetchInstalled) return;
  studyFetchInstalled = true;
  globalThis.fetch = throttledWikimediaFetch(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.hardcover.app") {
      if (
        hardcoverRemaining !== null &&
        hardcoverRemaining < MIN_HARDCOVER_REMAINING
      ) {
        throw new StudyStopped("Hardcover budget reached");
      }
      return await hardcoverFetch(input, init);
    }
    if (url.hostname.endsWith("hardcover.app")) {
      throw new StudyStopped("Hardcover website requests are forbidden");
    }
    return await nativeFetch(input, init);
  });
}

installStudyFetch();

const glossCache = new Map<string, Promise<string[]>>();

function glosses(word: string): Promise<string[]> {
  let result = glossCache.get(word);
  if (!result) {
    result = wiktionaryGlosses(word);
    glossCache.set(word, result);
  }
  return result;
}

async function firstGlosses(word: string): Promise<string[]> {
  for (const form of wordForms(word)) {
    const found = await glosses(form);
    if (found.length > 0) return found;
  }
  return [];
}

function glossHead(value: string): string {
  const words = value
    .replace(/\([^)]*\)/g, " ")
    .split(/(?:;|,|\bor\b)/i, 1)[0]
    .match(/[a-z]+(?:['-][a-z]+)*/gi) ?? [];
  while (/^(?:a|an|the|to)$/i.test(words[0] ?? "")) words.shift();
  return words.slice(0, 2).join(" ");
}

async function dictionaryTitle(title: string): Promise<string | null> {
  const translated: string[] = [];
  for (const word of title.match(/[\u0590-\u05ff']+/gu) ?? []) {
    const head = (await firstGlosses(word)).map(glossHead).find(Boolean);
    if (head) translated.push(head);
  }
  return translated.join(" ").trim() || null;
}

function surname(name: string): string {
  return normalize(name).split(" ").filter(Boolean).at(-1) ?? "";
}

function englishAuthorMatch(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  return a === b || (surname(a).length > 2 && surname(a) === surname(b));
}

export function authorsAgree(hebrew: string, english: string[]): boolean {
  if (!hebrew.trim() || english.length === 0) return false;
  return english.some((name) =>
    sameAuthor(hebrew, name) ||
    (surname(hebrew).length > 2 && surname(hebrew) === surname(name))
  );
}

type WikidataEntity = {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: {
    P50?: Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>;
  };
};

async function wikidata(params: Record<string, string>): Promise<any> {
  const response = await fetch(
    `https://www.wikidata.org/w/api.php?${new URLSearchParams({
      ...params,
      format: "json",
      origin: "*",
    })}`,
    { headers: { "User-Agent": "booknook-study/1.0" } },
  );
  if (!response.ok) {
    throw new Error(`Wikidata returned HTTP ${response.status}`);
  }
  return await response.json();
}

export async function independentCheck(
  hebrewTitle: string,
  hebrewAuthor: string,
  englishTitle: string,
  englishAuthors: string[],
): Promise<IndependentVerdict> {
  if (
    englishAuthors.length > 0 && !authorsAgree(hebrewAuthor, englishAuthors)
  ) {
    return { wikidata: null, score: null, verdict: "wrong" };
  }
  if (englishAuthors.length === 0 || !hebrewAuthor.trim()) {
    return { wikidata: null, score: null, verdict: "unknown" };
  }
  const search = await wikidata({
    action: "wbsearchentities",
    search: englishTitle,
    language: "en",
    type: "item",
    limit: "5",
  });
  const ids = (search.search ?? []).map((item: { id: string }) => item.id);
  if (ids.length === 0) {
    return { wikidata: null, score: null, verdict: "unknown" };
  }
  const data = await wikidata({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "labels|descriptions|claims",
    languages: "he|en",
  });
  const entities = data.entities as Record<string, WikidataEntity>;
  const authorIds = [
    ...new Set(
      ids.flatMap((id: string) =>
        (entities[id]?.claims?.P50 ?? []).map((claim) =>
          claim.mainsnak?.datavalue?.value?.id ?? ""
        ).filter(Boolean)
      ),
    ),
  ];
  const authorData = authorIds.length === 0
    ? { entities: {} }
    : await wikidata({
      action: "wbgetentities",
      ids: authorIds.join("|"),
      props: "labels",
      languages: "en",
    });
  for (const id of ids) {
    const entity = entities[id];
    const entityAuthors = (entity?.claims?.P50 ?? []).map((claim) =>
      authorData.entities?.[claim.mainsnak?.datavalue?.value?.id ?? ""]
        ?.labels?.en?.value as string | undefined
    ).filter(Boolean) as string[];
    const description = normalize(entity?.descriptions?.en?.value ?? "");
    const accepted = englishAuthors.some((author) =>
      entityAuthors.some((candidate) =>
        englishAuthorMatch(author, candidate)
      ) ||
      (surname(author).length > 2 && description.includes(surname(author)))
    );
    if (!accepted) continue;
    const label = entity?.labels?.he?.value ?? null;
    if (!label) return { wikidata: null, score: null, verdict: "unknown" };
    const score = similarity(hebrewTitle, label);
    return {
      wikidata: label,
      score,
      verdict: score >= 0.6 ? "right" : score < 0.4 ? "wrong" : "unknown",
    };
  }
  return { wikidata: null, score: null, verdict: "unknown" };
}

function escapeCell(value: string | null): string {
  return (value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function report(editions: number, found: Found[]): string {
  const right = found.filter((row) => row.verdict === "right").length;
  const wrong = found.filter((row) => row.verdict === "wrong").length;
  const unknown = found.filter((row) => row.verdict === "unknown").length;
  const accepted = found.filter((row) => row.accepted);
  const rows = found.map((row) =>
    `| ${escapeCell(row.hebrew)} | ${escapeCell(row.author)} | ${
      escapeCell(row.english)
    } | ${row.dictionaryEnglish.toFixed(2)} | ${
      row.dictionaryHebrew.toFixed(2)
    } | ${row.contradicted} | ${row.accepted ? "yes" : "no"} | ${
      escapeCell(row.wikidata)
    } | ${row.score === null ? "—" : row.score.toFixed(2)} | ${row.verdict} |`
  );
  return [
    `editions: ${editions}`,
    `checked: ${found.length}`,
    `right: ${right}`,
    `wrong: ${wrong}`,
    `unknown: ${unknown}`,
    `accepted: ${accepted.length}`,
    `accepted_right: ${
      accepted.filter((row) => row.verdict === "right").length
    }`,
    `accepted_wrong: ${
      accepted.filter((row) => row.verdict === "wrong").length
    }`,
    `accepted_unknown: ${
      accepted.filter((row) => row.verdict === "unknown").length
    }`,
    "",
    "| Hebrew title | Hebrew author | English title found | dict EN | dict HE | contradicted | accepted | Wikidata Hebrew label | similarity | verdict |",
    "|---|---|---|---:|---:|---:|---|---|---:|---|",
    ...rows,
    "",
  ].join("\n");
}

async function findBook(
  edition: Edition,
  translated: string,
): Promise<
  {
    book: HardcoverBook;
    dictionary: Awaited<ReturnType<typeof dictionaryVerdict>>;
  } | null
> {
  const book = await findHardcoverBook(translated, "", {
    requireAuthor: false,
  });
  if (!book) return null;
  return {
    book,
    dictionary: await dictionaryVerdict(edition.title, book.title, glosses),
  };
}

async function main(): Promise<void> {
  const sql = await openProdDb({ readOnly: true });
  try {
    await Deno.mkdir("docs/reports", { recursive: true });
    const editions = await sql<Edition[]>`
      select simania_id, title, author
      from public.editions
      where simania_id > 0 and work_id is null
      order by simania_id
    `;
    const initialRemaining = await hardcoverDailyRemaining();
    if (
      initialRemaining !== null && initialRemaining < MIN_HARDCOVER_REMAINING
    ) {
      throw new StudyStopped(
        `Hardcover daily remaining is ${initialRemaining}`,
      );
    }

    const found: Found[] = [];
    for (const [index, edition] of editions.entries()) {
      try {
        const translated = await dictionaryTitle(edition.title);
        if (!translated) continue;
        const match = await findBook(edition, translated);
        if (!match) continue;
        const { book, dictionary } = match;
        const bookAuthors = authors(book);
        const checked = await independentCheck(
          edition.title,
          edition.author ?? "",
          book.title,
          bookAuthors,
        );
        found.push({
          hebrew: edition.title,
          author: edition.author ?? "",
          english: book.title,
          dictionaryEnglish: dictionary.english,
          dictionaryHebrew: dictionary.hebrew,
          contradicted: dictionary.contradicted,
          accepted: dictionary.english >= 0.67 && dictionary.hebrew >= 0.67 &&
            dictionary.contradicted === 0,
          ...checked,
        });
      } catch (error) {
        if (error instanceof StudyStopped) throw error;
        throw new Error(`Edition ${edition.simania_id} failed`, {
          cause: error,
        });
      } finally {
        console.error(
          `processed ${
            index + 1
          }/${editions.length}; found ${found.length}; hardcover ${hardcoverCalls}`,
        );
      }
    }
    await Deno.writeTextFile(REPORT, report(editions.length, found));
    console.error(
      `hardcover_calls: ${hardcoverCalls}; hardcover_daily_remaining: ${hardcoverRemaining}`,
    );
  } finally {
    await sql.end();
  }
}

if (import.meta.main) await main();
