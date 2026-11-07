import {
  authors,
  findHardcoverBook,
  hardcoverBooks,
  hardcoverEnglishBooks,
} from "../supabase/functions/_shared/hardcover.ts";
import { hebrewCandidates } from "../supabase/functions/_shared/hebrew-candidates.ts";
import { localizeFallback } from "../public/js/recs.js";
import { fetchSimaniaPayload, searchBooks } from "../public/js/simania.js";

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

type OptionalCase = BookSpec & {
  allowed: number;
};

type ProbeResult = {
  hardcoverId: number | null;
  decision: number | null;
  providerErrors: string[];
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
];

const GUARD_CASES: GuardCase[] = [
  { title: "Aurora", author: "Kim Stanley Robinson", forbidden: 1013521 },
  { title: "Behind Closed Doors", author: "B.A. Paris", forbidden: 220768 },
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
        return { work_id: workId, ...response };
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

loadHardcoverApiKey();

const results = new Map<string, ProbeResult>();
for (const spec of [...EXPECTED_CASES, ...GUARD_CASES, ...OPTIONAL_CASES]) {
  const key = caseKey(spec);
  if (!results.has(key)) results.set(key, await probe(spec));
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
    } decided none expected ${expected}${errorsSuffix(result.providerErrors)}`,
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

if (exactExpectedLinks < 19) {
  failed = true;
  console.log(
    `FAIL expected-link total ${exactExpectedLinks}/21; at least 19 exact links are required`,
  );
} else {
  console.log(`PASS expected-link total ${exactExpectedLinks}/21`);
}

Deno.exit(failed ? 1 : 0);
