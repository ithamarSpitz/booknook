import { fetchTimeout, normalize, similarity } from "./utils.ts";

// Wikimedia's API etiquette requires a descriptive User-Agent; anonymous clients are throttled hard.
const PROVIDER_HEADERS = {
  "User-Agent": "BookNook/0.1 (personal Hebrew reading list; https://www.mediawiki.org/wiki/API:Etiquette)",
};

/** A provider answered with an error (after one retry), as opposed to answering "no match". */
export class ProviderError extends Error {}

async function providerFetch(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
  const headers = { ...PROVIDER_HEADERS, ...(init.headers as Record<string, string> | undefined) };
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchTimeout(url, { ...init, headers }, timeoutMs);
    if (response.ok) return response;
    await response.body?.cancel();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, (retryAfter > 0 ? retryAfter : 1) * 1000)));
      continue;
    }
    throw new ProviderError(`${new URL(url).host} returned ${response.status}`);
  }
}

const NLI_SRU = "https://nli.alma.exlibrisgroup.com/view/sru/972NNL_INST";
const WORK_TYPES = new Set(["Q571", "Q8261", "Q7725634", "Q47461344", "Q49084", "Q25379"]);
const REJECT_TYPES = new Set(["Q11424", "Q24856", "Q5398426", "Q277759", "Q7058673", "Q7889"]);

type Bridge = { title: string; author?: string; source: "Wikidata" | "NLI" };
type Entity = {
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>>;
};

function entityTypes(entity?: Entity | null): string[] {
  return (entity?.claims?.P31 ?? []).map((claim) => claim?.mainsnak?.datavalue?.value?.id).filter(Boolean) as string[];
}

function isWrittenWork(entity?: Entity | null): boolean {
  const types = entityTypes(entity);
  if (types.some((type) => REJECT_TYPES.has(type))) return false;
  return types.some((type) => WORK_TYPES.has(type)) || Boolean(entity?.claims?.P50?.length);
}

async function wikidataEntity(id: string, languages = "he|en"): Promise<Entity | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels|descriptions|claims&languages=${languages}&format=json&origin=*`;
  const response = await providerFetch(url);
  return (await response.json()).entities?.[id] ?? null;
}

async function wikidataAuthor(entity?: Entity | null, language = "en"): Promise<string> {
  const id = entity?.claims?.P50?.[0]?.mainsnak?.datavalue?.value?.id;
  if (!id) return "";
  return (await wikidataEntity(id, `${language}|en`))?.labels?.[language]?.value ?? "";
}

export async function wikidataOriginal(hebrewTitle: string): Promise<Bridge | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(hebrewTitle)}&language=he&uselang=en&type=item&limit=8&format=json&origin=*`;
  const response = await providerFetch(url);
  const search = (await response.json()).search ?? [];
  for (const candidate of search.slice(0, 6)) {
    const entity = await wikidataEntity(candidate.id);
    if (!isWrittenWork(entity)) continue;
    const title = entity?.labels?.en?.value ?? candidate.label;
    if (!title || normalize(title) === normalize(hebrewTitle)) continue;
    return { title, author: await wikidataAuthor(entity), source: "Wikidata" };
  }
  return null;
}

/** Recommendations only: a failure means no Hebrew edition this time, so it returns null. */
export async function wikidataHebrew(title: string, author = ""): Promise<Bridge | null> {
  try {
    return await wikidataHebrewLookup(title, author);
  } catch {
    return null;
  }
}

async function wikidataHebrewLookup(title: string, author: string): Promise<Bridge | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=en&uselang=en&type=item&limit=10&format=json&origin=*`;
  const response = await providerFetch(url);
  const candidates = ((await response.json()).search ?? [])
    .map((candidate: { id: string; label?: string; description?: string }) => ({
      candidate,
      score: similarity(title, candidate.label) * 3 + (author && normalize(candidate.description).includes(normalize(author)) ? 2 : 0),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
  for (const { candidate } of candidates.slice(0, 4)) {
    const entity = await wikidataEntity(candidate.id);
    if (!isWrittenWork(entity)) continue;
    const hebrewTitle = entity?.labels?.he?.value;
    if (!hebrewTitle) continue;
    return { title: hebrewTitle, author: await wikidataAuthor(entity, "he"), source: "Wikidata" };
  }
  return null;
}

type NliRecord = { title: string; creators: string[]; originals: string[] };

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function stripXml(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function marcFields(record: string, tag: string, codes: string[]): string[] {
  const fields = [...record.matchAll(new RegExp(`<(?:(?:\\w+):)?datafield\\b[^>]*tag=["']${tag}["'][^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?datafield>`, "gi"))];
  return fields.map((field) => {
    const parts = [...field[1].matchAll(/<(?:(?:\w+):)?subfield\b[^>]*code=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:(?:\w+):)?subfield>/gi)];
    return parts.filter((part) => codes.includes(part[1])).map((part) => stripXml(part[2])).join(" ").trim();
  }).filter(Boolean);
}

function parseNliRecords(xml: string): NliRecord[] {
  const records = [...xml.matchAll(/<(?:(?:\w+):)?record(?:\s[^>]*)?>([\s\S]*?)<\/(?:(?:\w+):)?record>/gi)];
  return records.map((match) => {
    const record = match[1];
    return {
      title: marcFields(record, "245", ["a", "b", "n", "p"])[0] ?? "",
      creators: [...marcFields(record, "100", ["a", "d"]), ...marcFields(record, "700", ["a", "d"])],
      originals: [...marcFields(record, "240", ["a", "n", "p"]), ...marcFields(record, "130", ["a", "n", "p"]), ...marcFields(record, "765", ["t"])],
    };
  }).filter((record) => record.title);
}

async function nliSearch(index: string, value: string, limit = 25): Promise<NliRecord[]> {
  const clean = value.replace(/["\\]/g, " ").trim();
  if (!clean) return [];
  const params = new URLSearchParams({
    version: "1.2",
    operation: "searchRetrieve",
    query: `alma.${index} all "${clean}"`,
    maximumRecords: String(limit),
    recordSchema: "marcxml",
  });
  const response = await providerFetch(`${NLI_SRU}?${params}`, { headers: { Accept: "application/xml,text/xml" } }, 18000);
  return parseNliRecords(await response.text());
}

function cleanOriginal(value: string): string {
  return value.replace(/\s*[\/.]\s*(?:Hebrew|עברית)\.?\s*$/i, "").replace(/[\s/.:;]+$/g, "").trim();
}

export async function nliOriginal(hebrewTitle: string, hebrewAuthor = ""): Promise<Bridge | null> {
  const records = await nliSearch("title", hebrewTitle);
  const ranked = records.map((record) => {
    const titleScore = similarity(hebrewTitle, record.title);
    const authorScore = hebrewAuthor ? Math.max(0, ...record.creators.map((creator) => similarity(hebrewAuthor, creator))) : 0;
    const original = record.originals.map(cleanOriginal).find((value) => value && normalize(value) !== normalize(record.title));
    return { record, original, titleScore, score: titleScore * 3 + authorScore * 2 };
  }).filter((item) => item.original && item.titleScore >= 0.78).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best ? { title: best.original!, author: best.record.creators[0] ?? "", source: "NLI" } : null;
}

/** Recommendations only: a failure means no Hebrew edition this time, so it returns null. */
export async function nliHebrew(originalTitle: string, originalAuthor = ""): Promise<Bridge | null> {
  try {
    return await nliHebrewLookup(originalTitle, originalAuthor);
  } catch {
    return null;
  }
}

async function nliHebrewLookup(originalTitle: string, originalAuthor: string): Promise<Bridge | null> {
  const seen = new Map<string, NliRecord>();
  for (const index of ["uniform_title", "title", "all_for_ui"]) {
    for (const record of await nliSearch(index, originalTitle)) {
      const key = `${normalize(record.title)}|${normalize(record.creators[0])}`;
      if (!seen.has(key)) seen.set(key, record);
    }
  }
  const ranked = [...seen.values()].filter((record) => /[\u0590-\u05ff]/.test(record.title)).map((record) => {
    const originalScore = Math.max(0, ...record.originals.map((value) => similarity(originalTitle, cleanOriginal(value))));
    const authorScore = originalAuthor ? Math.max(0, ...record.creators.map((creator) => similarity(originalAuthor, creator))) : 0;
    return { record, originalScore, score: originalScore * 4 + authorScore * 2 };
  }).filter((item) => item.originalScore >= 0.72).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.record;
  return best ? { title: best.title.replace(/[\s/.:;]+$/g, "").trim(), author: best.creators[0] ?? "", source: "NLI" } : null;
}
