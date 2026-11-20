import {
  authors,
  findHardcoverBook,
  hardcoverBooks,
  hardcoverEnglishBooks,
} from "../supabase/functions/_shared/hardcover.ts";
import { hebrewCandidates } from "../supabase/functions/_shared/hebrew-candidates.ts";
import { localizeFallback } from "../public/js/recs.js";
import { fetchSimaniaPayload, searchBooks } from "../public/js/simania.js";
import {
  authorAgrees,
  mainTitle,
  nameHits,
  soundAgrees,
  titleMatch,
} from "../public/js/hebrew-fallback.js";
import {
  fallbackPopulationRows,
  loadOperatorEnv,
  openProdDb,
} from "./lib/prod-db.ts";
import {
  buildFallbackCandidatesResponse,
  compareFallbackRuns,
  retryWikidata429,
} from "./lib/fallback-compare.ts";
import type { HebrewCandidate } from "../supabase/functions/_shared/hebrew-candidates.ts";
import { checkHardcoverBudget } from "./lib/hardcover-budget.ts";

const USAGE =
  "Usage: verify:fallback [--population|--replay-linked|--compare <before> <after>] [--min-hardcover <n>] [--force-hardcover]";

type BookSpec = {
  title: string;
  author: string;
};

type ExpectedCase = BookSpec & {
  expected: number[];
};

type GuardCase = BookSpec & {
  forbidden: number;
};

type NoDecisionCase = BookSpec;

type OptionalCase = BookSpec & {
  allowed: number;
};

type ProbeResult = {
  hardcoverId: number | null;
  decision: number | null;
  providerErrors: string[];
};

type PopulationRow = {
  source: string;
  user_id: string;
  display_name: string;
  work_id: string;
  hardcover_id: number | null;
  original_title: string;
  original_authors: string[];
};

type PopulationBook = {
  workId: string;
  hardcoverId: number;
  title: string;
  author: string;
  readers: Map<string, string>;
};

type LinkedEdition = {
  simania_id: number;
  resolve_status: string;
};

type ReplayRow = {
  work_id: string;
  hardcover_id: number | null;
  original_title: string;
  original_authors: string[];
  linked: LinkedEdition[];
};

const EXPECTED_CASES: ExpectedCase[] = [
  {
    title: "Before We Were Strangers",
    author: "Renee Carlino",
    expected: [990620],
  },
  {
    title: "Better Than the Movies",
    author: "Lynn Painter",
    expected: [1008203],
  },
  {
    title: "From Lukov with Love",
    author: "Mariana Zapata",
    expected: [1005485],
  },
  { title: "The Cheat Sheet", author: "Sarah Adams", expected: [1010339] },
  { title: "To Hate Adam Connor", author: "Ella Maise", expected: [989571] },
  { title: "Little Bear", author: "Else Holmelund Minarik", expected: [3659] },
  { title: "Behind Closed Doors", author: "B.A. Paris", expected: [986532] },
  { title: "Hidden Pictures", author: "Jason Rekulak", expected: [1007788] },
  { title: "Lexicon", author: "Max Barry", expected: [973447] },
  {
    title: "The Invisible Life of Addie LaRue",
    author: "V. E. Schwab",
    expected: [1005442],
  },
  {
    title: "The Kind Worth Killing",
    author: "Peter Swanson",
    expected: [984972],
  },
  {
    title: "The Last Thing He Told Me",
    author: "Laura Dave",
    expected: [1004977],
  },
  {
    title: "The Overnight Guest",
    author: "Heather Gudenkauf",
    expected: [1024242],
  },
  { title: "The Woman in Cabin 10", author: "Ruth Ware", expected: [990033] },
  { title: "The Women", author: "Kristin Hannah", expected: [1011037] },
  { title: "Snow Crash", author: "Neal Stephenson", expected: [977074] },
  { title: "Anxious People", author: "Fredrik Backman", expected: [1003668] },
  {
    title: "A Canticle for Leibowitz",
    author: "Walter M. Miller Jr.",
    expected: [42259, 1025481],
  },
  { title: "Girl in Landscape", author: "Jonathan Lethem", expected: [34027] },
  { title: "Small Island", author: "Andrea Levy", expected: [97143] },
  { title: "Never Lie", author: "Freida McFadden", expected: [1029088] },
  {
    title: "Don Quixote",
    author: "Miguel de Cervantes Saavedra",
    expected: [183461],
  },
];

const GUARD_CASES: GuardCase[] = [
  { title: "Aurora", author: "Kim Stanley Robinson", forbidden: 1013521 },
  { title: "Behind Closed Doors", author: "B.A. Paris", forbidden: 220768 },
  { title: "Pretty Girls", author: "Karin Slaughter", forbidden: 41212 },
  { title: "The Only One Left", author: "Riley Sager", forbidden: 1028558 },
  { title: "Regeneration", author: "Pat Barker", forbidden: 844 },
  {
    title: "The Folk of the Faraway Tree",
    author: "Enid Blyton",
    forbidden: 103718,
  },
  { title: "North Woods", author: "Daniel Mason", forbidden: 223491 },
];

const NO_DECISION_CASES: NoDecisionCase[] = [
  { title: "The Lathe of Heaven", author: "Ursula K. Le Guin" },
  { title: "Watchers", author: "Dean Koontz" },
];

const OPTIONAL_CASES: OptionalCase[] = [
  { title: "Grass", author: "Sheri S. Tepper", allowed: 20895 },
  {
    title: "Stories of Your Life and Others",
    author: "Ted Chiang",
    allowed: 42098,
  },
];

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
    if (eq < 1 || trimmed.slice(0, eq).trim() !== "HARDCOVER_API_KEY") continue;
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

function caseKey(spec: BookSpec): string {
  return `${spec.title}\u0000${spec.author}`;
}

function providerName(input: string | URL | Request): string {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    const host = new URL(raw).hostname;
    if (host.includes("hardcover")) return "Hardcover";
    if (host.includes("simania")) return "Simania";
    if (host.includes("wikidata")) return "Wikidata";
    if (host.includes("nli")) return "NLI";
    return host || "provider";
  } catch {
    return "provider";
  }
}

function displayId(id: number | null): string {
  return id == null ? "none" : String(id);
}

function errorsSuffix(errors: string[]): string {
  return errors.length ? `; provider errors: ${errors.join(", ")}` : "";
}

async function probe(spec: BookSpec): Promise<ProbeResult> {
  const providerErrors: string[] = [];
  const originalFetch = globalThis.fetch;
  const remember = (message: string) => {
    if (!providerErrors.includes(message)) providerErrors.push(message);
  };
  const trackedFetch: typeof fetch = async (input, init) => {
    const provider = providerName(input);
    try {
      const response = await originalFetch(input, init);
      if (!response.ok) remember(`${provider} HTTP ${response.status}`);
      return response;
    } catch (error) {
      const kind = error instanceof Error ? error.name : "Error";
      remember(`${provider} ${kind}`);
      throw error;
    }
  };

  globalThis.fetch = trackedFetch;
  try {
    let found;
    try {
      found = await findHardcoverBook(spec.title, spec.author, {
        requireAuthor: true,
      });
    } catch (error) {
      remember(`Hardcover ${error instanceof Error ? error.name : "Error"}`);
      return { hardcoverId: null, decision: null, providerErrors };
    }
    if (!found) {
      return { hardcoverId: null, decision: null, providerErrors };
    }

    let book;
    let detailed;
    try {
      [book] = await hardcoverBooks([found.id]);
      [detailed] = await hardcoverEnglishBooks([found.id]);
    } catch (error) {
      remember(`Hardcover ${error instanceof Error ? error.name : "Error"}`);
      return { hardcoverId: found.id, decision: null, providerErrors };
    }
    if (!book || !detailed) {
      return { hardcoverId: found.id, decision: null, providerErrors };
    }

    const englishAuthor = authors(book)[0] ?? spec.author;
    const response = await hebrewCandidates({
      title: book.title,
      author: englishAuthor,
      description: detailed.description ?? null,
    }, { fetch: trackedFetch });

    const workId = `hardcover-${book.id}`;
    const decision = await localizeFallback({
      work_id: workId,
      simania_id: null,
      title: book.title,
      author: englishAuthor,
      cover_url: book.image?.url ?? null,
      score: 0,
      because: [],
      because_titles: [],
      shared_tags: [],
      dismissed: false,
      generated_at: "",
      english_only: true,
      can_add: true,
      hebrew_hint: null,
      hebrew_author: null,
    }, {
      isCurrent: () => true,
      callFunction: async (name: string) => {
        if (name !== "hebrew-candidates") {
          throw new Error(`Unexpected function call: ${name}`);
        }
        return buildFallbackCandidatesResponse(workId, response, detailed);
      },
      searchBooks: async (query: string, limit?: number) => {
        try {
          return await searchBooks(query, limit, trackedFetch);
        } catch (error) {
          remember(
            `Simania search ${error instanceof Error ? error.name : "Error"}`,
          );
          throw error;
        }
      },
      fetchPayload: async (simaniaId: number) => {
        try {
          return await fetchSimaniaPayload(simaniaId, trackedFetch);
        } catch (error) {
          remember(
            `Simania details ${error instanceof Error ? error.name : "Error"}`,
          );
          throw error;
        }
      },
    });

    return {
      hardcoverId: book.id,
      decision: Number.isSafeInteger(decision) && Number(decision) > 0
        ? Number(decision)
        : null,
      providerErrors,
    };
  } catch {
    return { hardcoverId: null, decision: null, providerErrors };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function simaniaIdOf(book: unknown): number | null {
  if (!book || typeof book !== "object") return null;
  const value = Number(
    (book as { id?: unknown; bookId?: unknown }).id ??
      (book as { bookId?: unknown }).bookId,
  );
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function matchingSearchBook(
  candidate: HebrewCandidate,
  englishAuthor: string,
  decision: number,
  searches: Map<string, unknown[]>,
): { id: number; title: string; author: string } | null {
  const shortTitle = mainTitle(candidate.title);
  const queries = [
    `${shortTitle} ${candidate.author ?? ""}`.trim(),
    shortTitle,
  ];
  for (const query of queries) {
    for (const raw of searches.get(query) ?? []) {
      const book = raw as { title?: unknown; author?: unknown };
      if (simaniaIdOf(book) !== decision) continue;
      const title = String(book.title ?? "");
      const author = String(book.author ?? "");
      if (!titleMatch(candidate.title, title)) continue;
      const agrees = candidate.rule === "E" || candidate.rule === "F"
        ? soundAgrees(author, englishAuthor)
        : authorAgrees(candidate.author ?? "", author, englishAuthor);
      if (agrees) return { id: decision, title, author };
    }
  }
  return null;
}

async function populationDecision(spec: PopulationBook) {
  const providerErrors: string[] = [];
  const searches = new Map<string, unknown[]>();
  const payloads = new Map<number, unknown>();
  const originalFetch = globalThis.fetch;
  const remember = (message: string) => {
    if (!providerErrors.includes(message)) providerErrors.push(message);
  };
  const trackedFetch: typeof fetch = async (input, init) => {
    const provider = providerName(input);
    try {
      const response = await originalFetch(input, init);
      if (!response.ok) remember(`${provider} HTTP ${response.status}`);
      return response;
    } catch (error) {
      remember(`${provider} ${error instanceof Error ? error.name : "Error"}`);
      throw error;
    }
  };

  globalThis.fetch = trackedFetch;
  try {
    let book;
    let detailed;
    try {
      [book] = await hardcoverBooks([spec.hardcoverId]);
      [detailed] = await hardcoverEnglishBooks([spec.hardcoverId]);
    } catch (error) {
      throw new Error(
        `Hardcover failure for ${spec.title}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!book || !detailed) {
      throw new Error(`Hardcover failure for ${spec.title}: missing book data`);
    }

    const englishAuthor = authors(book)[0] ?? spec.author;
    const response = await hebrewCandidates({
      title: book.title,
      author: englishAuthor,
      description: detailed.description ?? null,
    }, { fetch: trackedFetch });
    const rec = {
      work_id: spec.workId,
      simania_id: null,
      title: book.title,
      author: englishAuthor,
      cover_url: book.image?.url ?? null,
      score: 0,
      because: [],
      because_titles: [],
      shared_tags: [],
      dismissed: false,
      generated_at: "",
      english_only: true,
      can_add: true,
      hebrew_hint: null,
      hebrew_author: null,
    };
    const decision = await localizeFallback(rec, {
      isCurrent: () => true,
      callFunction: async () =>
        buildFallbackCandidatesResponse(spec.workId, response, detailed),
      searchBooks: async (query: string, limit?: number) => {
        try {
          const books = await searchBooks(query, limit, trackedFetch);
          searches.set(query, books);
          await new Promise((resolve) => setTimeout(resolve, 250));
          return books;
        } catch (error) {
          remember(
            `Simania search ${error instanceof Error ? error.name : "Error"}`,
          );
          throw error;
        }
      },
      fetchPayload: async (simaniaId: number) => {
        try {
          const payload = await fetchSimaniaPayload(simaniaId, trackedFetch);
          payloads.set(simaniaId, payload);
          return payload;
        } catch (error) {
          remember(
            `Simania details ${error instanceof Error ? error.name : "Error"}`,
          );
          throw error;
        }
      },
    });

    const decidedId = Number.isSafeInteger(decision) && Number(decision) > 0
      ? Number(decision)
      : null;
    let rule: string | null = null;
    let hebrewTitle: string | null = null;
    if (decidedId != null) {
      for (const tier of ["A", "B", "D", "C", "E", "F"] as const) {
        for (
          const candidate of response.candidates.filter((item) =>
            item.rule === tier
          )
        ) {
          const match = matchingSearchBook(
            candidate,
            englishAuthor,
            decidedId,
            searches,
          );
          if (match) {
            rule = tier;
            hebrewTitle = match.title;
            break;
          }
        }
        if (rule) break;
      }
      if (!rule) rule = "G";
    }

    const gEditions = [...payloads].map(([simaniaId, raw]) => {
      const payload = raw as {
        details?: { title?: unknown; description?: unknown };
      };
      return {
        simania_id: simaniaId,
        title: String(payload.details?.title ?? ""),
        all_hits: nameHits(
          response.english_names,
          String(payload.details?.description ?? ""),
        ),
      };
    });
    const gEvidence = gEditions.map((edition) => ({
      ...edition,
      distinctive_hits: edition.all_hits.filter((name) =>
        !gEditions.some((other) =>
          other.simania_id !== edition.simania_id &&
          other.all_hits.includes(name)
        )
      ),
    }));
    if (rule === "G") {
      hebrewTitle = gEvidence.find((item) =>
        item.simania_id === decidedId
      )?.title ?? null;
    }

    return {
      decision: decidedId,
      rule,
      hebrewTitle,
      gEvidence,
      providerErrors,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decideWithRetries(book: PopulationBook) {
  return retryWikidata429(
    () => populationDecision(book),
    () => wait(30_000),
  );
}

async function runPopulation(
  openDb: typeof openProdDb = openProdDb,
): Promise<void> {
  loadOperatorEnv();
  const sql = await openDb({ readOnly: true });
  try {
    const rows = await fallbackPopulationRows(
      sql,
    ) as unknown as PopulationRow[];
    const books = new Map<string, PopulationBook>();
    for (const row of rows) {
      if (row.hardcover_id == null) {
        throw new Error(`Work ${row.work_id} has no Hardcover ID.`);
      }
      let book = books.get(row.work_id);
      if (!book) {
        book = {
          workId: row.work_id,
          hardcoverId: row.hardcover_id,
          title: row.original_title,
          author: row.original_authors[0] ?? "",
          readers: new Map(),
        };
        books.set(row.work_id, book);
      }
      book.readers.set(row.user_id, row.display_name);
    }

    let decided = 0;
    let errors = 0;
    const byRule: Record<string, number> = {};
    for (const book of books.values()) {
      let result;
      try {
        result = await decideWithRetries(book);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Hardcover failure")) throw error;
        errors++;
        console.log(JSON.stringify({
          title: book.title,
          author: book.author,
          readers: [...book.readers.values()].sort(),
          simania_id: null,
          hebrew_title: null,
          rule: null,
          errors: [message],
        }));
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (result.decision != null) decided++;
      if (result.rule) byRule[result.rule] = (byRule[result.rule] ?? 0) + 1;
      if (result.providerErrors.length) errors++;
      console.log(JSON.stringify({
        title: book.title,
        author: book.author,
        readers: [...book.readers.values()].sort(),
        simania_id: result.decision,
        hebrew_title: result.hebrewTitle,
        rule: result.rule,
        ...(result.gEvidence.length ? { rule_g: result.gEvidence } : {}),
        ...(result.providerErrors.length
          ? { errors: result.providerErrors }
          : {}),
      }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log(JSON.stringify({
      totals: { books: books.size, decided, by_rule: byRule, errors },
    }));
  } finally {
    await sql.end();
  }
}

async function runReplayLinked(
  openDb: typeof openProdDb = openProdDb,
): Promise<void> {
  loadOperatorEnv();
  const sql = await openDb({ readOnly: true });
  try {
    const rows = await sql`
      select
        w.id as work_id,
        w.hardcover_id,
        w.original_title,
        w.original_authors,
        json_agg(
          json_build_object(
            'simania_id', linked.simania_id,
            'resolve_status', linked.resolve_status
          ) order by linked.simania_id
        ) as linked
      from public.works as w
      inner join public.editions as linked
        on linked.work_id = w.id and linked.simania_id > 0
      where exists (
          select 1
          from public.shelf_books as sb
          inner join public.editions as shelved on shelved.simania_id = sb.simania_id
          where shelved.work_id = w.id
        )
        or exists (
          select 1 from public.recommendations as r where r.work_id = w.id
        )
        or exists (
          select 1
          from public.genre_recommendations as g
          where g.work_id = w.id
        )
      group by w.id, w.hardcover_id, w.original_title, w.original_authors
      order by w.original_title, w.id
    ` as unknown as ReplayRow[];

    let decided = 0;
    let sameAsLinked = 0;
    let differentFromLinked = 0;
    let none = 0;
    let errors = 0;
    for (const row of rows) {
      const linked = row.linked.map((edition) => ({
        simania_id: Number(edition.simania_id),
        resolve_status: edition.resolve_status,
      }));
      const title = row.original_title;
      const author = row.original_authors[0] ?? "";
      if (row.hardcover_id == null) {
        errors++;
        none++;
        console.log(JSON.stringify({
          hardcover_id: null,
          title,
          author,
          linked,
          simania_id: null,
          rule: null,
          errors: [`Work ${row.work_id} has no Hardcover ID.`],
        }));
        await wait(1000);
        continue;
      }

      const book: PopulationBook = {
        workId: row.work_id,
        hardcoverId: row.hardcover_id,
        title,
        author,
        readers: new Map(),
      };
      try {
        const result = await decideWithRetries(book);
        if (result.decision == null) {
          none++;
        } else {
          decided++;
          if (
            linked.some((edition) => edition.simania_id === result.decision)
          ) {
            sameAsLinked++;
          } else {
            differentFromLinked++;
          }
        }
        if (result.providerErrors.length) errors++;
        console.log(JSON.stringify({
          hardcover_id: row.hardcover_id,
          title,
          author,
          linked,
          simania_id: result.decision,
          rule: result.rule,
          ...(result.gEvidence.length ? { rule_g: result.gEvidence } : {}),
          ...(result.providerErrors.length
            ? { errors: result.providerErrors }
            : {}),
        }));
      } catch (error) {
        errors++;
        none++;
        console.log(JSON.stringify({
          hardcover_id: row.hardcover_id,
          title,
          author,
          linked,
          simania_id: null,
          rule: null,
          errors: [error instanceof Error ? error.message : String(error)],
        }));
      }
      await wait(1000);
    }
    console.log(JSON.stringify({
      totals: {
        works: rows.length,
        decided,
        same_as_linked: sameAsLinked,
        different_from_linked: differentFromLinked,
        none,
        errors,
      },
    }));
  } finally {
    await sql.end();
  }
}

function readKeepFile(path: string): Set<string> {
  return new Set(
    Deno.readTextFileSync(path).split(/\r?\n/).map((line) => line.trim())
      .filter(
        Boolean,
      ),
  );
}

function runCompare(args: string[]): number {
  const compareAt = args.indexOf("--compare");
  const beforePath = args[compareAt + 1];
  const afterPath = args[compareAt + 2];
  if (
    !beforePath || !afterPath || beforePath.startsWith("--") ||
    afterPath.startsWith("--")
  ) {
    console.error("Usage: --compare <before> <after> [--keep <file>]");
    return 2;
  }
  const keepAt = args.indexOf("--keep");
  const keepPath = keepAt >= 0 ? args[keepAt + 1] : undefined;
  if (keepAt >= 0 && (!keepPath || keepPath.startsWith("--"))) {
    console.error("Usage: --compare <before> <after> [--keep <file>]");
    return 2;
  }

  try {
    const comparison = compareFallbackRuns(
      Deno.readTextFileSync(beforePath),
      Deno.readTextFileSync(afterPath),
      keepPath ? readKeepFile(keepPath) : new Set(),
    );
    for (const change of comparison.changes) {
      console.log(JSON.stringify(change));
    }
    console.log(JSON.stringify({ unverified: comparison.unverified }));
    console.log(JSON.stringify({
      only_before: comparison.onlyBefore,
      only_after: comparison.onlyAfter,
    }));
    console.log(JSON.stringify({ counts: comparison.counts }));
    return comparison.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

async function runCases(): Promise<number> {
  loadHardcoverApiKey();
  const results = new Map<string, ProbeResult>();
  for (
    const spec of [
      ...EXPECTED_CASES,
      ...GUARD_CASES,
      ...NO_DECISION_CASES,
      ...OPTIONAL_CASES,
    ]
  ) {
    const key = caseKey(spec);
    if (!results.has(key)) {
      results.set(
        key,
        await retryWikidata429(() => probe(spec), () => wait(30_000)),
      );
    }
  }

  let failed = false;
  let exactExpectedLinks = 0;
  let toleratedProviderFailures = 0;
  for (const spec of EXPECTED_CASES) {
    const result = results.get(caseKey(spec))!;
    const expected = spec.expected.join(" or ");
    if (result.decision != null && spec.expected.includes(result.decision)) {
      exactExpectedLinks++;
      console.log(
        `PASS ${spec.title} Hardcover ${
          displayId(result.hardcoverId)
        } decided ${result.decision} expected ${expected}${
          errorsSuffix(result.providerErrors)
        }`,
      );
      continue;
    }
    if (result.decision != null) {
      failed = true;
      console.log(
        `FAIL ${spec.title} Hardcover ${
          displayId(result.hardcoverId)
        } decided ${result.decision} expected ${expected}${
          errorsSuffix(result.providerErrors)
        }`,
      );
      continue;
    }
    if (result.providerErrors.length && toleratedProviderFailures < 2) {
      toleratedProviderFailures++;
      console.log(
        `PASS ${spec.title} Hardcover ${
          displayId(result.hardcoverId)
        } decided none expected ${expected}; tolerated provider failure ${toleratedProviderFailures}/2${
          errorsSuffix(result.providerErrors)
        }`,
      );
      continue;
    }
    failed = true;
    console.log(
      `FAIL ${spec.title} Hardcover ${
        displayId(result.hardcoverId)
      } decided none expected ${expected}${
        errorsSuffix(result.providerErrors)
      }`,
    );
  }

  for (const spec of GUARD_CASES) {
    const result = results.get(caseKey(spec))!;
    const pass = result.decision !== spec.forbidden;
    if (!pass) failed = true;
    console.log(
      `${
        pass ? "PASS" : "FAIL"
      } ${spec.title} must not decide ${spec.forbidden}; decided ${
        displayId(result.decision)
      }${errorsSuffix(result.providerErrors)}`,
    );
  }

  for (const spec of NO_DECISION_CASES) {
    const result = results.get(caseKey(spec))!;
    const pass = result.decision == null;
    if (!pass) failed = true;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${spec.title} must decide nothing; decided ${
        displayId(result.decision)
      }${errorsSuffix(result.providerErrors)}`,
    );
  }

  for (const spec of OPTIONAL_CASES) {
    const result = results.get(caseKey(spec))!;
    const pass = result.decision == null || result.decision === spec.allowed;
    if (!pass) failed = true;
    console.log(
      `${
        pass ? "PASS" : "FAIL"
      } ${spec.title} may decide none or ${spec.allowed}; decided ${
        displayId(result.decision)
      }${errorsSuffix(result.providerErrors)}`,
    );
  }

  if (exactExpectedLinks < 20) {
    failed = true;
    console.log(
      `FAIL expected-link total ${exactExpectedLinks}/22; at least 20 exact links are required`,
    );
  } else {
    console.log(`PASS expected-link total ${exactExpectedLinks}/22`);
  }

  return failed ? 1 : 0;
}

interface MainDeps {
  checkHardcoverBudget: typeof checkHardcoverBudget;
  openProdDb: typeof openProdDb;
  log: (line: string) => void;
  error: (line: string) => void;
}

const defaults: MainDeps = {
  checkHardcoverBudget,
  openProdDb,
  log: console.log,
  error: console.error,
};

export async function main(
  args: string[] = Deno.args,
  overrides: Partial<MainDeps> = {},
): Promise<number> {
  const deps = { ...defaults, ...overrides };
  let minHardcover = 1500;
  const minIndexes = args.flatMap((arg, index) =>
    arg === "--min-hardcover" ? [index] : []
  );
  if (minIndexes.length > 0) {
    const value = args[minIndexes[0] + 1];
    if (
      minIndexes.length !== 1 ||
      value === undefined ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    ) {
      deps.error(USAGE);
      return 2;
    }
    minHardcover = Number(value);
  }

  if (args.includes("--compare")) return runCompare(args);

  if (args.includes("--population") || args.includes("--replay-linked")) {
    const budgetOkay = await deps.checkHardcoverBudget({
      min: minHardcover,
      force: args.includes("--force-hardcover"),
      log: deps.log,
    });
    if (!budgetOkay) return 4;

    try {
      if (args.includes("--population")) {
        await runPopulation(deps.openProdDb);
      } else {
        await runReplayLinked(deps.openProdDb);
      }
      return 0;
    } catch (error) {
      deps.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  return await runCases();
}

if (import.meta.main) Deno.exit(await main());
