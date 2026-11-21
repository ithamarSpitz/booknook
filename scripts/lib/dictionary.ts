export type DictionaryCandidate = { simania_id: number; title: string };
export type Glosses = (word: string) => Promise<string[]>;

const PREFIXES = new Set(["ה", "ו", "ב", "ל", "מ", "ש", "כ"]);
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "to",
  "in",
  "on",
  "for",
  "with",
  "by",
]);
const glossCaches = new WeakMap<Glosses, Map<string, Promise<string[]>>>();

export function wordForms(word: string): string[] {
  const forms: string[] = [];
  const queued: string[] = [];
  const add = (form: string) => {
    if (form && !forms.includes(form)) {
      forms.push(form);
      queued.push(form);
    }
  };
  add(word);
  if ([...word].length > 2 && PREFIXES.has(word[0])) add(word.slice(1));
  if ([...word].length > 3 && PREFIXES.has(word[0]) && word[1] === "ה") {
    add(word.slice(2));
  }
  for (let i = 0; i < queued.length; i++) {
    const form = queued[i];
    if (form.endsWith("ים") || form.endsWith("ות")) add(form.slice(0, -2));
    if (form.endsWith("ת")) add(`${form.slice(0, -1)}ה`);
    if (form.endsWith("י")) add(`${form.slice(0, -1)}ים`);
  }
  return forms;
}

function cachedGlosses(glosses: Glosses, word: string): Promise<string[]> {
  let cache = glossCaches.get(glosses);
  if (!cache) {
    cache = new Map();
    glossCaches.set(glosses, cache);
  }
  let answer = cache.get(word);
  if (!answer) {
    answer = glosses(word);
    cache.set(word, answer);
  }
  return answer;
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function covered(word: string, joined: string): boolean {
  if (new RegExp(`\\b${regexEscape(word)}\\b`, "i").test(joined)) return true;
  let stem = word.replace(/(?:ies|es|s|er|ing|ed)$/i, "");
  if (stem.length > 2 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1);
  return Boolean(stem) &&
    new RegExp(`\\b${regexEscape(stem)}[a-z]*`, "i").test(joined);
}

export async function dictionaryScore(
  hebrewTitle: string,
  englishTitle: string,
  glosses: Glosses,
): Promise<number> {
  const content = (englishTitle.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((word) => !STOP_WORDS.has(word));
  if (content.length === 0) return 0;

  const definitions: string[] = [];
  for (const word of hebrewTitle.match(/[\u0590-\u05ff]+/gu) ?? []) {
    for (const form of wordForms(word)) {
      const answer = await cachedGlosses(glosses, form);
      if (answer.length > 0) {
        definitions.push(...answer);
        break;
      }
    }
  }
  const joined = definitions.join(" ").toLowerCase();
  return content.filter((word) => covered(word, joined)).length /
    content.length;
}

export async function pickByDictionary(
  englishTitle: string,
  candidates: DictionaryCandidate[],
  glosses: Glosses,
): Promise<DictionaryCandidate | null> {
  const scored: Array<{ candidate: DictionaryCandidate; score: number }> = [];
  for (const candidate of candidates) {
    scored.push({
      candidate,
      score: await dictionaryScore(candidate.title, englishTitle, glosses),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (
    !best || best.score < 0.5 ||
    scored.some((item, i) => i > 0 && item.score === best.score)
  ) {
    return null;
  }
  return best.candidate;
}
