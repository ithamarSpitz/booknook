import { nliHebrew, wikidataHebrew } from "./bridges.ts";
import { mainTitle, titleMatch } from "./fallback-match.ts";
import { nameSoundScore } from "./names.ts";
import { normalize, similarity } from "./utils.ts";

const NLI = "https://nli.alma.exlibrisgroup.com/view/sru/972NNL_INST";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const HEBREW = /[\u0590-\u05ff]/;
const LIMIT_MS = 20_000;

export type HebrewCandidateRule = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type HebrewCandidate = {
  title: string;
  author: string | null;
  rule: HebrewCandidateRule;
};

type Record = { title: string; author: string; original: string };
type BridgeLookup = (
  title: string,
  author?: string,
) => Promise<{ title: string; author?: string | null; source: string } | null>;
type Deps = {
  fetch: typeof fetch;
  wikidataHebrew: BridgeLookup;
  nliHebrew: BridgeLookup;
  clock: () => number;
};

const defaults: Deps = {
  fetch: globalThis.fetch.bind(globalThis),
  wikidataHebrew,
  nliHebrew,
  clock: Date.now,
};

function decodeXml(value: string): string {
  return value.replace(
    /&#x([0-9a-f]+);/gi,
    (_, n) => String.fromCodePoint(Number.parseInt(n, 16)),
  )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function fieldValues(xml: string, tag: string): string[] {
  const fields = new RegExp(
    `<(?:[\\w-]+:)?datafield\\b[^>]*\\btag=["']${tag}["'][^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?datafield>`,
    "gi",
  );
  const values: string[] = [];
  for (const field of xml.matchAll(fields)) {
    const parts = [...field[1].matchAll(
      /<(?:[\w-]+:)?subfield\b[^>]*\bcode=["'][a-z0-9]["'][^>]*>([\s\S]*?)<\/(?:[\w-]+:)?subfield>/gi,
    )].map((match) => decodeXml(match[1].replace(/<[^>]+>/g, "")).trim())
      .filter(Boolean);
    if (parts.length) values.push(parts.join(" "));
  }
  return values;
}

export function parseNliMarc(xml: string): Record[] {
  const chunks = xml.split(/<(?:[\w-]+:)?record\b[^>]*>/i).slice(1);
  const records: Record[] = [];
  for (const chunk of chunks) {
    const rawTitle = fieldValues(chunk, "245")[0] ?? "";
    if (!HEBREW.test(rawTitle)) continue;
    const title = rawTitle.split(/\s+\/\s+/)[0]
      .replace(/\[[^\]]*\]/g, " ").replace(/[\s:/.;]+$/g, "")
      .replace(/\s+/g, " ").trim();
    if (!title) continue;
    let author = fieldValues(chunk, "100")[0] ?? "";
    author = author.replace(/,?\s*\d{4}\s*-?\s*(?:\d{4})?.*$/g, "")
      .replace(/(?:\s|,)+(?:מחבר|מחברת|author).*$/i, "")
      .replace(/[\s,;:/]+$/g, "").trim();
    if (author.includes(",")) {
      const [last, first] = author.split(",", 2);
      author = `${first.trim()} ${last.trim()}`.trim();
    }
    const original = (fieldValues(chunk, "240")[0] ?? "")
      .replace(/\.?\s*Hebrew\.?\s*$/i, "").trim();
    records.push({ title, author, original });
  }
  return records;
}

function authority(author: string): string {
  const words = author.trim().split(/\s+/).filter((word) =>
    !/^jr\.?$/i.test(word)
  );
  return words.length ? `${words.at(-1)}, ${words[0]}` : "";
}

function cleanQuery(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(ms, LIMIT_MS)));
}

async function fetchText(
  fetcher: typeof fetch,
  url: string,
  remaining: number,
): Promise<string> {
  if (remaining <= 0) throw new Error("hebrew-candidates deadline exceeded");
  const response = await fetcher(url, { signal: timeoutSignal(remaining) });
  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}`);
  }
  return await response.text();
}

async function nliRecords(
  query: string,
  deps: Deps,
  remaining: () => number,
): Promise<Record[]> {
  const params = new URLSearchParams({
    version: "1.2",
    operation: "searchRetrieve",
    query,
    maximumRecords: "100",
    recordSchema: "marcxml",
  });
  return parseNliMarc(
    await fetchText(deps.fetch, `${NLI}?${params}`, remaining()),
  );
}

async function wikidataJson(
  params: globalThis.Record<string, string>,
  deps: Deps,
  remaining: () => number,
): Promise<any> {
  const text = await fetchText(
    deps.fetch,
    `${WIKIDATA}?${new URLSearchParams({ format: "json", ...params })}`,
    remaining(),
  );
  return JSON.parse(text);
}

async function withinDeadline<T>(
  operation: () => Promise<T>,
  remaining: number,
): Promise<T> {
  if (remaining <= 0) throw new Error("hebrew-candidates deadline exceeded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("hebrew-candidates deadline exceeded")),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function wikidataOriginalTitles(
  title: string,
  author: string,
  deps: Deps,
  remaining: () => number,
): Promise<string[]> {
  const search = await wikidataJson(
    {
      action: "wbsearchentities",
      search: mainTitle(title),
      language: "en",
      type: "item",
      limit: "6",
    },
    deps,
    remaining,
  );
  const ids = (search.search ?? []).map((item: any) => item.id).filter(Boolean);
  if (!ids.length) return [];
  const works = (await wikidataJson(
    {
      action: "wbgetentities",
      ids: ids.join("|"),
      props: "labels|claims",
    },
    deps,
    remaining,
  )).entities ?? {};
  const authorIds = [
    ...new Set(
      ids.flatMap((id: string) =>
        (works[id]?.claims?.P50 ?? []).map((claim: any) =>
          claim.mainsnak?.datavalue?.value?.id
        ).filter(Boolean)
      ),
    ),
  ];
  const authors = authorIds.length
    ? (await wikidataJson(
      {
        action: "wbgetentities",
        ids: authorIds.join("|"),
        props: "labels",
        languages: "en",
      },
      deps,
      remaining,
    )).entities ?? {}
    : {};
  const wantedLast = normalize(author).split(" ").at(-1);
  for (const id of ids) {
    const work = works[id];
    const workAuthorIds = (work?.claims?.P50 ?? []).map((claim: any) =>
      claim.mainsnak?.datavalue?.value?.id
    ).filter(Boolean);
    const agrees = workAuthorIds.some((authorId: string) => {
      const name = authors[authorId]?.labels?.en?.value ?? "";
      return similarity(name, author) >= 0.5 ||
        (wantedLast && normalize(name).split(" ").at(-1) === wantedLast);
    });
    if (!agrees) continue;
    const claims = (work.claims?.P1476 ?? []).map((claim: any) =>
      claim.mainsnak?.datavalue?.value?.text
    ).filter(Boolean);
    const labels = Object.values(work.labels ?? {}).map((label: any) =>
      label.value
    )
      .filter((value): value is string => typeof value === "string");
    return [...new Set([...claims, ...labels])].filter((value) =>
      !HEBREW.test(value)
    );
  }
  return [];
}

const STOP_WORDS = new Set(
  `the a an and but or when after before now in on at of for from with without this that these those he she him her his hers they them their theirs its it we us our ours you your yours i me my mine who whom whose as if yet so then there here new york times book review bestselling author novel award january february march april may june july august september october november december zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty hundred thousand million first second third fourth fifth last`
    .split(/\s+/),
);

export function extractEnglishNames(
  description: string | null,
  title: string,
  author: string,
): string[] {
  if (!description) return [];
  const excluded = new Set(
    `${title} ${author}`.normalize("NFKD").replace(/\p{M}/gu, "")
      .toLowerCase().match(/[a-z]+/g) ?? [],
  );
  const plain = description.replace(/<[^>]+>/g, " ");
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of plain.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    const word = match[1];
    const before = plain.slice(0, match.index);
    const sentenceStart = Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
    );
    if (/^[\s"'“”‘’(\[]*$/.test(before.slice(sentenceStart + 1))) continue;
    const key = word.toLowerCase();
    if (STOP_WORDS.has(key) || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    names.push(word);
  }
  return names;
}

export async function hebrewCandidates(
  work: { title: string; author: string; description: string | null },
  overrides: Partial<Deps> = {},
): Promise<{ candidates: HebrewCandidate[]; english_names: string[] }> {
  const deps = { ...defaults, ...overrides };
  const started = deps.clock();
  const remaining = () => LIMIT_MS - (deps.clock() - started);
  const title = mainTitle(work.title);
  const creator = cleanQuery(authority(work.author));
  const records: Record[] = [];
  const seenRecords = new Set<string>();
  const addRecords = (items: Record[]) => {
    for (const item of items) {
      const key = `${normalize(item.title)}|${normalize(item.author)}|${
        normalize(item.original)
      }`;
      if (!seenRecords.has(key)) {
        seenRecords.add(key);
        records.push(item);
      }
    }
  };
  for (
    const query of [
      `alma.creator all "${creator}" AND alma.uniform_title all "${
        cleanQuery(title)
      }"`,
      `alma.creator all "${creator}"`,
    ]
  ) {
    try {
      addRecords(await nliRecords(query, deps, remaining));
    } catch {
      // Each NLI request is independent; records from the other one remain usable.
    }
  }

  let originals: string[] = [];
  try {
    originals = await wikidataOriginalTitles(
      work.title,
      work.author,
      deps,
      remaining,
    );
  } catch {
    // Rule D is omitted when its Wikidata lookup fails.
  }
  let wd: Awaited<ReturnType<BridgeLookup>> = null;
  try {
    wd = await withinDeadline(
      () => deps.wikidataHebrew(work.title, work.author),
      remaining(),
    );
  } catch {
    // Rules C/F are omitted when their bridge fails.
  }
  let nli: Awaited<ReturnType<BridgeLookup>> = null;
  try {
    nli = await withinDeadline(
      () => deps.nliHebrew(work.title, work.author),
      remaining(),
    );
  } catch {
    // Rule E is omitted when its bridge fails.
  }

  const candidates: HebrewCandidate[] = [];
  const seenTitles = new Set<string>();
  const add = (candidate: HebrewCandidate) => {
    const key = normalize(candidate.title);
    if (!key || seenTitles.has(key) || candidates.length >= 8) return;
    seenTitles.add(key);
    candidates.push(candidate);
  };
  for (const record of records) {
    if (record.original && titleMatch(record.original, work.title)) {
      add({ title: record.title, author: record.author || null, rule: "A" });
    }
  }
  for (const record of records) {
    if (!record.original && nameSoundScore(record.title, [title]) >= 0.85) {
      add({ title: record.title, author: record.author || null, rule: "B" });
    }
  }
  for (const record of records) {
    if (
      record.original &&
      originals.some((original) => titleMatch(record.original, original))
    ) {
      add({ title: record.title, author: record.author || null, rule: "D" });
    }
  }
  let cFound = false;
  if (wd?.title) {
    for (const record of records) {
      if (titleMatch(record.title, wd.title)) {
        cFound = true;
        add({ title: record.title, author: record.author || null, rule: "C" });
      }
    }
  }
  if (nli?.title) add({ title: nli.title, author: null, rule: "E" });
  if (wd?.title && !cFound) add({ title: wd.title, author: null, rule: "F" });
  for (const record of records) {
    if (!record.original) {
      add({ title: record.title, author: record.author || null, rule: "G" });
    }
  }
  return {
    candidates,
    english_names: extractEnglishNames(
      work.description,
      work.title,
      work.author,
    ),
  };
}
