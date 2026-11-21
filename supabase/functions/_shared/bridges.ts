import { fetchTimeout, normalize, similarity } from "./utils.ts";

// Wikimedia's API etiquette requires a descriptive User-Agent; anonymous clients are throttled hard.
const PROVIDER_HEADERS = {
  "User-Agent": "BookNook/0.1 (personal Hebrew reading list; https://www.mediawiki.org/wiki/API:Etiquette)",
};

/** A provider answered with an error (after one retry), as opposed to answering "no match". */
export class ProviderError extends Error {}

class WikidataResponseError extends ProviderError {}

async function providerFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
  allowNotFound = false,
): Promise<Response> {
  const headers = { ...PROVIDER_HEADERS, ...(init.headers as Record<string, string> | undefined) };
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchTimeout(url, { ...init, headers }, timeoutMs);
    if (response.ok || (allowNotFound && response.status === 404)) return response;
    await response.body?.cancel();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, (retryAfter > 0 ? retryAfter : 1) * 1000)));
      continue;
    }
    throw new ProviderError(`${new URL(url).host} returned ${response.status}`);
  }
}

/** English Wiktionary definitions for a Hebrew word. */
export async function wiktionaryGlosses(word: string): Promise<string[]> {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  const response = await providerFetch(url, {}, undefined, true);
  if (response.status === 404) {
    await response.body?.cancel();
    return [];
  }
  const body = await response.json() as {
    he?: Array<{ definitions?: Array<{ definition?: unknown }> }>;
  };
  if (!Array.isArray(body?.he)) return [];
  return body.he.flatMap((section) =>
    Array.isArray(section?.definitions)
      ? section.definitions.flatMap((entry) =>
        typeof entry?.definition === "string"
          ? [entry.definition.replace(/<[^>]*>/g, "").toLowerCase()]
          : []
      )
      : []
  );
}

const NLI_SRU = "https://nli.alma.exlibrisgroup.com/view/sru/972NNL_INST";
const WORK_TYPES = new Set(["Q571", "Q8261", "Q7725634", "Q47461344", "Q49084", "Q25379"]);
const REJECT_TYPES = new Set(["Q11424", "Q24856", "Q5398426", "Q277759", "Q7058673", "Q7889", "Q1667921", "Q13593966", "Q7725310"]);

type Bridge = { title: string; author?: string; versoAuthor?: string; source: "Wikidata" | "NLI" };
type Entity = {
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>>;
};

async function wikidataField<T>(response: Response, field: string): Promise<T> {
  const body = await response.json() as unknown;
  if (typeof body !== "object" || body === null || "error" in body || !(field in body)) {
    throw new WikidataResponseError(`www.wikidata.org returned an invalid ${field} response`);
  }
  return (body as Record<string, unknown>)[field] as T;
}

function entityTypes(entity?: Entity | null): string[] {
  return (entity?.claims?.P31 ?? []).map((claim) => claim?.mainsnak?.datavalue?.value?.id).filter(Boolean) as string[];
}

function isWrittenWork(entity?: Entity | null): boolean {
  const types = entityTypes(entity);
  if (types.some((type) => REJECT_TYPES.has(type))) return false;
  return types.some((type) => WORK_TYPES.has(type)) || Boolean(entity?.claims?.P50?.length);
}

function isHuman(entity?: Entity | null): boolean {
  return entityTypes(entity).includes("Q5");
}

async function wikidataEntity(id: string, languages = "he|en"): Promise<Entity | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels|descriptions|claims&languages=${languages}&format=json&origin=*`;
  const response = await providerFetch(url);
  const entities = await wikidataField<Record<string, Entity>>(response, "entities");
  return entities[id] ?? null;
}

async function wikidataAuthor(entity?: Entity | null, language = "en"): Promise<string> {
  const id = entity?.claims?.P50?.[0]?.mainsnak?.datavalue?.value?.id;
  if (!id) return "";
  return (await wikidataEntity(id, `${language}|en`))?.labels?.[language]?.value ?? "";
}

function cleanHebrewWikidataLabel(label: string): string {
  let result = label.trim();
  while (true) {
    const match = result.match(/^(.+?)\s+\([^)]+\)$/);
    if (!match) break;
    const stripped = match[1].trim();
    if (!stripped) break;
    result = stripped;
  }
  return result;
}

async function wikidataAuthorMatchesHint(entity: Entity | null, authorHint: string): Promise<boolean> {
  const claims = entity?.claims?.P50 ?? [];
  for (const claim of claims.slice(0, 2)) {
    const id = claim?.mainsnak?.datavalue?.value?.id;
    if (!id) continue;
    const authorEntity = await wikidataEntity(id, "en");
    const label = authorEntity?.labels?.en?.value ?? "";
    if (similarity(authorHint, label) > 0.45) return true;
  }
  return false;
}

export async function wikidataOriginal(hebrewTitle: string): Promise<Bridge | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(hebrewTitle)}&language=he&uselang=en&type=item&limit=8&format=json&origin=*`;
  const response = await providerFetch(url);
  const search = await wikidataField<Array<{ id: string; label?: string }>>(response, "search");
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
  const candidates = (await wikidataField<Array<{ id: string; label?: string; description?: string }>>(response, "search"))
    .map((candidate: { id: string; label?: string; description?: string }) => ({
      candidate,
      score: similarity(title, candidate.label) * 3 + (author && normalize(candidate.description).includes(normalize(author)) ? 2 : 0),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
  const checkedWorks = new Set<string>();
  const authorHint = author.trim();
  for (const { candidate } of candidates.slice(0, 4)) {
    let entity = await wikidataEntity(candidate.id);
    let workId = candidate.id;
    const editionOf = entity?.claims?.P629?.[0]?.mainsnak?.datavalue?.value?.id;
    if (editionOf) {
      workId = editionOf;
      if (checkedWorks.has(workId)) continue;
      entity = await wikidataEntity(editionOf);
    } else if (checkedWorks.has(workId)) {
      continue;
    }
    checkedWorks.add(workId);
    if (!isWrittenWork(entity)) continue;
    if (entity?.claims?.P50?.length && authorHint) {
      if (!(await wikidataAuthorMatchesHint(entity, authorHint))) continue;
    }
    const rawHebrew = entity?.labels?.he?.value;
    if (!rawHebrew) continue;
    const hebrewTitle = cleanHebrewWikidataLabel(rawHebrew);
    if (!hebrewTitle) continue;
    return { title: hebrewTitle, author: await wikidataAuthor(entity, "he"), source: "Wikidata" };
  }
  return null;
}

/** Throws `ProviderError` on a provider failure; null means Wikidata has no Hebrew name. */
export async function wikidataHebrewAuthorStrict(englishName: string): Promise<string | null> {
  return await wikidataHebrewAuthorLookup(englishName);
}

export async function wikidataHebrewAuthor(englishName: string): Promise<string | null> {
  try {
    return await wikidataHebrewAuthorStrict(englishName);
  } catch {
    return null;
  }
}

async function wikidataHebrewAuthorLookup(englishName: string): Promise<string | null> {
  const name = englishName.trim();
  if (!name) return null;
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=5&format=json&origin=*`;
  const response = await providerFetch(url);
  const search = await wikidataField<Array<{ id: string; label?: string }>>(response, "search");
  let reads = 0;
  for (const candidate of search) {
    if (reads >= 3) break;
    if (similarity(name, candidate.label) !== 1) continue;
    reads += 1;
    const entity = await wikidataEntity(candidate.id, "he|en");
    if (!isHuman(entity)) continue;
    const heLabel = entity?.labels?.he?.value;
    if (!heLabel) continue;
    return heLabel;
  }
  return null;
}

/** Throws `ProviderError` on a provider failure; null means Wikidata has no English name. */
export async function wikidataEnglishAuthorStrict(hebrewName: string): Promise<string | null> {
  return await wikidataEnglishAuthorLookup(hebrewName);
}

export async function wikidataEnglishAuthor(hebrewName: string): Promise<string | null> {
  try {
    return await wikidataEnglishAuthorStrict(hebrewName);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return null;
  }
}

async function wikidataEnglishAuthorLookup(hebrewName: string): Promise<string | null> {
  const name = hebrewName.trim();
  if (!name) return null;
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=he&uselang=en&type=item&limit=5&format=json&origin=*`;
  const response = await providerFetch(url);
  const search = await wikidataField<Array<{ id: string; label?: string }>>(response, "search");
  let reads = 0;
  for (const candidate of search) {
    if (reads >= 3) break;
    reads += 1;
    const entity = await wikidataEntity(candidate.id, "he|en");
    if (!isHuman(entity)) continue;
    const heLabel = entity?.labels?.he?.value ?? "";
    if (similarity(name, heLabel) < 0.8) continue;
    const enLabel = entity?.labels?.en?.value;
    if (!enLabel) continue;
    return enLabel;
  }
  return null;
}

type SparqlRow = Record<string, { value?: string } | undefined>;

function sparqlLiteral(value: string, language: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@${language}`;
}

async function wikidataSparqlChunks(
  inputs: string[],
  language: string,
  buildQuery: (values: string) => string,
): Promise<Array<{ input: string; rows: SparqlRow[] }>> {
  const unique = [...new Set(inputs.map((input) => input.trim()).filter(Boolean))];
  const results: Array<{ input: string; rows: SparqlRow[] }> = [];
  for (let start = 0; start < unique.length; start += 100) {
    const chunk = unique.slice(start, start + 100);
    const query = buildQuery(chunk.map((input) => sparqlLiteral(input, language)).join(" "));
    const response = await providerFetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }).toString(),
    });
    let bindings: SparqlRow[];
    try {
      const body = await response.json() as { results?: { bindings?: unknown } };
      if (!Array.isArray(body?.results?.bindings)) throw new Error("no bindings");
      bindings = body.results.bindings as SparqlRow[];
    } catch {
      throw new ProviderError("query.wikidata.org returned an invalid response");
    }
    const key = language === "en" ? "name" : "he";
    for (const input of chunk) {
      results.push({ input, rows: bindings.filter((row) => row[key]?.value === input) });
    }
  }
  return results;
}

function addDistinct(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

export async function wikidataHebrewAuthors(names: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const chunks = await wikidataSparqlChunks(names, "en", (values) =>
    `SELECT ?name ?he WHERE {
  VALUES ?name { ${values} }
  ?item rdfs:label|skos:altLabel ?name .
  ?item wdt:P31 wd:Q5 .
  ?item rdfs:label ?he FILTER(lang(?he) = "he")
}`);
  for (const { input, rows } of chunks) {
    for (const row of rows) if (row.he?.value) addDistinct(found, input, row.he.value);
  }
  return found;
}

export async function wikidataOriginals(hebrewTitles: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const chunks = await wikidataSparqlChunks(hebrewTitles, "he", (values) =>
    `SELECT ?he ?type ?en WHERE {
  VALUES ?he { ${values} }
  ?x rdfs:label ?he .
  OPTIONAL { ?x wdt:P629 ?w }
  BIND(COALESCE(?w, ?x) AS ?item)
  OPTIONAL { ?item wdt:P31 ?type }
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
}`);
  for (const { input, rows } of chunks) {
    for (const row of rows) {
      const en = row.en?.value;
      const type = row.type?.value?.split("/").pop() ?? "";
      if (en && WORK_TYPES.has(type)) addDistinct(found, input, en);
    }
  }
  return found;
}

type NliOriginal = { title: string; versoAuthor?: string };
type NliRecord = {
  title: string;
  mainTitle: string;
  hebrewAlternateTitles: string[];
  creators: string[];
  originals: NliOriginal[];
};

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

function marcSubfields(record: string, tag: string): Array<Array<{ code: string; value: string }>> {
  const fields = [...record.matchAll(new RegExp(`<(?:(?:\\w+):)?datafield\\b[^>]*tag=["']${tag}["'][^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?datafield>`, "gi"))];
  return fields.map((field) =>
    [...field[1].matchAll(/<(?:(?:\w+):)?subfield\b[^>]*code=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:(?:\w+):)?subfield>/gi)]
      .map((part) => ({ code: part[1], value: stripXml(part[2]) }))
  );
}

function hasLatinWithoutHebrew(value: string): boolean {
  return /[A-Za-z]/.test(value) && !/[\u0590-\u05ff]/.test(value);
}

function cleanVersoPart(value: string): string {
  return value.replace(/[\s:\/;,.]+$/g, "").trim();
}

function parseNliRecords(xml: string): NliRecord[] {
  const records = [...xml.matchAll(/<(?:(?:\w+):)?record(?:\s[^>]*)?>([\s\S]*?)<\/(?:(?:\w+):)?record>/gi)];
  return records.map((match) => {
    const record = match[1];
    const translationLanguages = marcSubfields(record, "041")
      .flat()
      .filter((subfield) => subfield.code === "h")
      .map((subfield) => subfield.value.trim().toLowerCase());
    const versoOriginals: NliOriginal[] = translationLanguages.some((value) => value !== "heb")
      ? marcSubfields(record, "246").flatMap((subfields) => {
        const indication = subfields.find((subfield) => subfield.code === "i")?.value ?? "";
        const rawTitle = subfields.find((subfield) => subfield.code === "a")?.value ?? "";
        if (!indication.startsWith("Title page verso") || !hasLatinWithoutHebrew(rawTitle)) return [];
        const title = cleanVersoPart(rawTitle);
        if (!title) return [];
        const rawAuthor = subfields.find((subfield) => subfield.code === "b")?.value ?? "";
        const versoAuthor = hasLatinWithoutHebrew(rawAuthor)
          ? cleanVersoPart(rawAuthor.split(";", 1)[0])
          : "";
        return [{ title, ...(versoAuthor ? { versoAuthor } : {}) }];
      })
      : [];
    return {
      title: marcFields(record, "245", ["a", "b", "n", "p"])[0] ?? "",
      mainTitle: cleanVersoPart(marcFields(record, "245", ["a"])[0] ?? ""),
      hebrewAlternateTitles: marcFields(record, "246", ["a"])
        .filter((title) => /[\u0590-\u05ff]/.test(title))
        .map(cleanVersoPart)
        .filter(Boolean),
      creators: [...marcFields(record, "100", ["a", "d"]), ...marcFields(record, "700", ["a", "d"])],
      originals: [
        ...marcFields(record, "240", ["a", "n", "p"]).map((title) => ({ title })),
        ...marcFields(record, "130", ["a", "n", "p"]).map((title) => ({ title })),
        ...marcFields(record, "765", ["t"]).map((title) => ({ title })),
        ...versoOriginals,
      ],
    };
  }).filter((record) => record.title);
}

function cleanNliValue(value: string): string {
  return value.replace(/["\\]/g, " ").trim();
}

function authorSurname(hebrewAuthor: string): string {
  const segment = hebrewAuthor.split(",")[0]?.trim() ?? "";
  if (!segment) return "";
  const words = segment.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  return last.replace(/["\\]/g, "").trim();
}

async function nliSearchQuery(query: string, limit = 25): Promise<NliRecord[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    version: "1.2",
    operation: "searchRetrieve",
    query,
    maximumRecords: String(limit),
    recordSchema: "marcxml",
  });
  const response = await providerFetch(`${NLI_SRU}?${params}`, { headers: { Accept: "application/xml,text/xml" } }, 18000);
  return parseNliRecords(await response.text());
}

async function nliSearch(index: string, value: string, limit = 25): Promise<NliRecord[]> {
  const clean = cleanNliValue(value);
  if (!clean) return [];
  return nliSearchQuery(`alma.${index} all "${clean}"`, limit);
}

function cleanOriginal(value: string): string {
  return value.replace(/\s*[\/.]\s*(?:Hebrew|עברית)\.?\s*$/i, "").replace(/[\s/.:;]+$/g, "").trim();
}

function nliOriginalFromRecords(hebrewTitle: string, hebrewAuthor: string, records: NliRecord[]): Bridge | null {
  const ranked = records.map((record) => {
    const titleScore = Math.max(
      similarity(hebrewTitle, record.title),
      similarity(hebrewTitle, record.mainTitle),
      ...record.hebrewAlternateTitles.map((title) => similarity(hebrewTitle, title)),
    );
    const authorScore = hebrewAuthor ? Math.max(0, ...record.creators.map((creator) => similarity(hebrewAuthor, creator))) : 0;
    const original = record.originals
      .map((candidate) => ({ ...candidate, title: cleanOriginal(candidate.title) }))
      .find((candidate) => candidate.title && normalize(candidate.title) !== normalize(record.title));
    return { record, original, titleScore, score: titleScore * 3 + authorScore * 2 };
  }).filter((item) => item.original && item.titleScore >= 0.78).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best
    ? {
      title: best.original!.title,
      author: best.record.creators[0] ?? "",
      ...(best.original!.versoAuthor ? { versoAuthor: best.original!.versoAuthor } : {}),
      source: "NLI",
    }
    : null;
}

export async function nliOriginal(hebrewTitle: string, hebrewAuthor = ""): Promise<Bridge | null> {
  const surname = authorSurname(hebrewAuthor);
  const cleanTitle = cleanNliValue(hebrewTitle);
  if (surname && cleanTitle) {
    const fromAuthorSearch = nliOriginalFromRecords(
      hebrewTitle,
      hebrewAuthor,
      await nliSearchQuery(`alma.title all "${cleanTitle}" AND alma.creator all "${surname}"`),
    );
    if (fromAuthorSearch) return fromAuthorSearch;
  }
  return nliOriginalFromRecords(hebrewTitle, hebrewAuthor, await nliSearch("title", hebrewTitle));
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
    const originalScore = Math.max(0, ...record.originals.map((candidate) => similarity(originalTitle, cleanOriginal(candidate.title))));
    const authorScore = originalAuthor ? Math.max(0, ...record.creators.map((creator) => similarity(originalAuthor, creator))) : 0;
    return { record, originalScore, score: originalScore * 4 + authorScore * 2 };
  }).filter((item) => item.originalScore >= 0.72).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.record;
  return best ? { title: best.title.replace(/[\s/.:;]+$/g, "").trim(), author: best.creators[0] ?? "", source: "NLI" } : null;
}
