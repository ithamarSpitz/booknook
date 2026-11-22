import { similarity } from "../../supabase/functions/_shared/utils.ts";

const FUNCTION_WORDS = new Set([
  "of",
  "the",
  "and",
  "to",
  "in",
  "on",
  "with",
  "for",
  "a",
  "an",
]);

const strip = (title: string) =>
  title.replace(/\(.*?\)|:.*$/g, "").replace(/^the\s+/i, "").trim();

function words(title: string): string[] {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];
}

export function nliEnglishMismatch(
  workTitle: string,
  nliTitle: string,
): boolean {
  const nliWords = words(nliTitle);
  if (!nliWords.some((word) => FUNCTION_WORDS.has(word))) return false;

  const score = Math.max(
    similarity(workTitle, nliTitle),
    similarity(strip(workTitle), strip(nliTitle)),
  );
  if (score >= 0.6) return false;

  const significantWorkWords = words(workTitle).filter((word) =>
    word.length > 2 && word !== "the" && word !== "and"
  );
  const nliWordSet = new Set(nliWords);
  return !significantWorkWords.every((word) => nliWordSet.has(word));
}
