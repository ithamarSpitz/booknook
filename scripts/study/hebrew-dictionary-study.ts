import type { Sql } from "npm:postgres@3.4.5";
import {
  type AuthorStore,
  englishNames,
  nameKey,
} from "../../supabase/functions/_shared/authors.ts";
import {
  nliOriginal,
  wikidataEnglishAuthorStrict,
  wiktionaryGlosses,
} from "../../supabase/functions/_shared/bridges.ts";
import {
  authors,
  findHardcoverBook,
  type HardcoverBook,
} from "../../supabase/functions/_shared/hardcover.ts";
import { similarity } from "../../supabase/functions/_shared/utils.ts";
import { sqlAuthorStore } from "../lib/author-store.ts";
import { dictionaryVerdict, wordForms } from "../lib/dictionary.ts";
import { hardcoverDailyRemaining } from "../lib/hardcover-budget.ts";
import { openProdDb } from "../lib/prod-db.ts";
import { authorAgreesWithWork } from "../lib/rematch.ts";

const REPORT = "docs/reports/2026-11-22-hebrew-dictionary-study.md";
const MIN_HARDCOVER_REMAINING = 800;
const MAX_HARDCOVER_CALLS = 300;
const WIKIMEDIA_GAP_MS = 300;

type Edition = {
  simania_id: number;
  title: string;
  author: string | null;
};

type Found = {
  hebrew: string;
  english: string;
  nli: string | null;
  verdict: "right" | "wrong" | "unknown";
};

class StudyStopped extends Error {}

const nativeFetch = globalThis.fetch.bind(globalThis);
let hardcoverCalls = 0;
let hardcoverRemaining: number | null = null;
let wikimediaTail: Promise<void> = Promise.resolve();
let lastWikimediaStart = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wikimediaFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  let release!: () => void;
  const previous = wikimediaTail;
  wikimediaTail = new Promise<void>((resolve) => release = resolve);
  await previous;
  try {
    for (let attempt = 0;; attempt++) {
      const wait = WIKIMEDIA_GAP_MS - (Date.now() - lastWikimediaStart);
      if (wait > 0) await sleep(wait);
      lastWikimediaStart = Date.now();
      const response = await nativeFetch(input, init);
      if (response.status !== 429 || attempt >= 4) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await sleep(
        Math.max(WIKIMEDIA_GAP_MS, (retryAfter > 0 ? retryAfter : 1) * 1000),
      );
    }
  } finally {
    release();
  }
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "api.hardcover.app") {
    if (
      hardcoverCalls >= MAX_HARDCOVER_CALLS ||
      (hardcoverRemaining !== null &&
        hardcoverRemaining < MIN_HARDCOVER_REMAINING)
    ) {
      throw new StudyStopped("Hardcover budget reached");
    }
    hardcoverCalls++;
    const response = await nativeFetch(input, init);
    const raw = response.headers.get("x-ratelimit-daily-remaining");
    if (raw !== null && /^\d+$/.test(raw.trim())) {
      hardcoverRemaining = Number(raw);
    }
    return response;
  }
  if (
    url.hostname.endsWith("wikidata.org") ||
    url.hostname.endsWith("wiktionary.org")
  ) {
    return await wikimediaFetch(input, init);
  }
  if (url.hostname.endsWith("hardcover.app")) {
    throw new StudyStopped("Hardcover website requests are forbidden");
  }
  return await nativeFetch(input, init);
};

function readOnlyAuthorStore(sql: Sql): AuthorStore {
  const store = sqlAuthorStore(sql);
  return {
    ...store,
    create: () => Promise.resolve(crypto.randomUUID()),
    addNames: () => Promise.resolve(),
    merge: () => Promise.resolve(),
    markWikidataChecked: () => Promise.resolve(),
    markSoundChecked: () => Promise.resolve(),
  };
}

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

async function knownHebrewNames(
  store: AuthorStore,
  englishAuthors: string[],
): Promise<string[]> {
  const names: string[] = [];
  for (const author of englishAuthors) {
    const key = nameKey(author);
    if (!key) continue;
    const found = await store.find("en", key);
    for (const row of found?.names ?? []) {
      if (row.lang === "he" && !names.includes(row.name)) names.push(row.name);
    }
  }
  return names;
}

function stripForCheck(title: string): string {
  let value = title.replace(/\([^)]*\)/g, " ");
  value = value.split(":", 1)[0];
  return value.trim().replace(/^the\s+/i, "").trim();
}

function escapeCell(value: string | null): string {
  return (value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function report(editions: number, found: Found[]): string {
  const right = found.filter((row) => row.verdict === "right").length;
  const wrong = found.filter((row) => row.verdict === "wrong").length;
  const unknown = found.filter((row) => row.verdict === "unknown").length;
  const rows = found.map((row) =>
    `| ${escapeCell(row.hebrew)} | ${escapeCell(row.english)} | ${
      escapeCell(row.nli)
    } | ${row.verdict} |`
  );
  return [
    `editions: ${editions}`,
    `found: ${found.length}`,
    `right: ${right}`,
    `wrong: ${wrong}`,
    `unknown: ${unknown}`,
    "",
    "| Hebrew title | English title found | NLI original | verdict |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

async function findBook(
  edition: Edition,
  translated: string,
  englishAuthor: string,
): Promise<HardcoverBook | null> {
  const book = await findHardcoverBook(translated, englishAuthor, {
    requireAuthor: true,
    retryWithAuthor: true,
    soundAuthor: edition.author ?? "",
  });
  if (!book) return null;
  const verdict = await dictionaryVerdict(edition.title, book.title, glosses);
  return verdict.english >= 0.67 && verdict.hebrew >= 0.67 &&
      verdict.contradicted === 0
    ? book
    : null;
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
    const store = readOnlyAuthorStore(sql);
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
        const englishAuthor = (await englishNames(store, edition.author ?? "", {
          wikidataEnglishAuthorStrict,
          now: () => new Date(),
        }))[0] ?? "";
        const book = await findBook(edition, translated, englishAuthor);
        if (!book) continue;
        const bookAuthors = authors(book);
        if (
          !authorAgreesWithWork(
            edition.author ?? "",
            bookAuthors,
            await knownHebrewNames(store, bookAuthors),
          )
        ) continue;

        const original = await nliOriginal(edition.title, edition.author ?? "");
        const verdict = original === null ? "unknown" : similarity(
            stripForCheck(book.title),
            stripForCheck(original.title),
          ) >= 0.6
          ? "right"
          : "wrong";
        found.push({
          hebrew: edition.title,
          english: book.title,
          nli: original?.title ?? null,
          verdict,
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
