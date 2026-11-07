import { nameSoundScore } from "./names.js";
import { normalize, similarity } from "./simania.js";

/** @param {string} title @returns {string} */
export function mainTitle(title) {
  const withoutTags = String(title ?? "").replace(/\[[^\]]*\]/g, " ");
  const separator = withoutTags.search(/[:(]/);
  return (separator < 0 ? withoutTags : withoutTags.slice(0, separator))
    .replace(/\s+/g, " ").trim();
}

/** @param {string} left @param {string} right @returns {number} */
function bigramDice(left, right) {
  if (!left || !right) return 0;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const counts = new Map();
  for (let i = 0; i + 1 < left.length; i++) {
    const gram = left.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i + 1 < right.length; i++) {
    const gram = right.slice(i, i + 2);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      shared++;
      counts.set(gram, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length - 2);
}

/** @param {string} left @param {string} right @returns {boolean} */
export function titleMatch(left, right) {
  const a = mainTitle(left);
  const b = mainTitle(right);
  return similarity(a, b) >= 0.8 ||
    bigramDice(normalize(a), normalize(b)) >= 0.85;
}

/** @param {string} value @returns {string} */
function lastWord(value) {
  const words = normalize(value).split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? "";
}

/** @param {string} hebrewAuthor @param {string} simaniaAuthor @param {string} englishAuthor @returns {boolean} */
export function authorAgrees(hebrewAuthor, simaniaAuthor, englishAuthor) {
  if (similarity(hebrewAuthor, simaniaAuthor) >= 0.5) return true;
  if (nameSoundScore(simaniaAuthor, [englishAuthor]) >= 0.7) return true;
  const expectedLast = lastWord(hebrewAuthor);
  return expectedLast !== "" && expectedLast === lastWord(simaniaAuthor);
}

/** @param {string} simaniaAuthor @param {string} englishAuthor @returns {boolean} */
export function soundAgrees(simaniaAuthor, englishAuthor) {
  return nameSoundScore(simaniaAuthor, [englishAuthor]) >= 0.7;
}

/** @param {string[]} englishNames @param {string} hebrewDescription @returns {string[]} */
export function nameHits(englishNames, hebrewDescription) {
  const tokens = new Set();
  const normalized = String(hebrewDescription ?? "")
    .replace(/[׳’`]/g, "'")
    .replace(/״/g, '"');
  for (const word of normalized.split(/[^א-ת'"]+/)) {
    const token = word.replace(/^['"]+|['"]+$/g, "");
    if (token.replace(/['"]/g, "").length < 3) continue;
    tokens.add(token);
    if (/^[והבלמשכ]/.test(token) && token.length > 3) {
      tokens.add(token.slice(1));
    }
  }
  return (Array.isArray(englishNames) ? englishNames : []).filter((name) =>
    [...tokens].some((token) => nameSoundScore(token, [name]) >= 0.85)
  );
}
