// Name sound score (docs/contract.md, "Catalog fallback for English-only
// books"). Pure and deterministic: no network, no database.

import { stripHebrewPoints } from "./utils.ts";

const HEBREW_LETTERS: Record<string, string> = {
  "ב": "b",
  "ג": "g",
  "ד": "d",
  "ו": "v",
  "ז": "z",
  "ח": "h",
  "ט": "t",
  "כ": "k",
  "ך": "k",
  "ק": "k",
  "ל": "l",
  "מ": "m",
  "ם": "m",
  "נ": "n",
  "ן": "n",
  "ס": "s",
  "ש": "s",
  "צ": "s",
  "ץ": "s",
  "פ": "p",
  "ף": "p",
  "ר": "r",
  "ת": "t",
};
const HEBREW_GERESH: Record<string, string> = {
  "ג": "j",
  "צ": "ch",
  "ץ": "ch",
};
const GERESH = new Set(["׳", "'", "’", "`"]);
const SOUND_CLASSES: Record<string, string> = {
  b: "p",
  p: "p",
  f: "p",
  v: "p",
  w: "p",
  g: "k",
  k: "k",
  c: "k",
  q: "k",
  x: "k",
  j: "k",
  d: "t",
  t: "t",
  s: "s",
  z: "s",
  h: "h",
  l: "l",
  m: "m",
  n: "n",
  r: "r",
};

/** Latin consonant skeleton of a Hebrew-script name. */
function buildHebrewSkeleton(
  name: string,
  vowelAwareVav: boolean,
  latinX: boolean,
): string {
  const chars = Array.from(stripHebrewPoints(name ?? ""));
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (next !== undefined && GERESH.has(next) && ch in HEBREW_GERESH) {
      out += HEBREW_GERESH[ch];
      i++;
      continue;
    }
    // A single vav is normally a vowel in transliterated names; doubled vav
    // carries the consonantal v/w sound.
    if (vowelAwareVav && ch === "ו") {
      if (next === "ו") {
        out += "v";
        i++;
      }
      continue;
    }
    // Hebrew transliterates Latin x as the two-letter sequence קס.
    if (latinX && ch === "ק" && next === "ס") {
      out += "x";
      i++;
      continue;
    }
    // א ה ע י, geresh and anything unmapped drop.
    out += HEBREW_LETTERS[ch] ?? "";
  }
  return out;
}

/** Latin consonant skeleton of a Hebrew-script name. */
export function hebrewSkeleton(name: string): string {
  return buildHebrewSkeleton(name, false, false);
}

/** Consonant skeleton of a Latin-script name. */
export function latinSkeleton(name: string): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/tch/g, "ch")
    .replace(/ch/g, "k")
    .replace(/sh/g, "s")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[aeiouy]/g, "")
    .replace(/[^a-z]/g, "");
}

function silentGhLatinSkeleton(name: string): string {
  return latinSkeleton((name ?? "").replace(/gh/gi, ""));
}

function soundKey(skeleton: string): string {
  skeleton = skeleton.replace(/ch/g, "k");
  let out = "";
  for (const ch of skeleton) {
    const cls = SOUND_CLASSES[ch];
    if (cls === undefined) continue;
    if (out[out.length - 1] !== cls) out += cls;
  }
  return out;
}

function bigrams(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < text.length; i++) out.push(text.slice(i, i + 2));
  return out;
}

function bigramDice(a: string, b: string): number {
  if (a === "" || b === "") return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const gram of left) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let shared = 0;
  for (const gram of right) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      shared++;
      counts.set(gram, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

function latinParts(name: string): string[] {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[a-z]+/g) ?? [];
}

function initialScore(
  hebrewName: string,
  latinName: string,
  vowelAwareVav: boolean,
  latinX: boolean,
): number {
  const hebrewParts = (hebrewName ?? "").trim().split(/\s+/u).filter(Boolean);
  const latinWords = latinParts(latinName);
  if (
    hebrewParts.length !== latinWords.length ||
    !latinWords.some((part) => part.length === 1)
  ) return 0;
  const hebrewKeys = hebrewParts.map((part) =>
    soundKey(buildHebrewSkeleton(part, vowelAwareVav, latinX))
  );
  if (hebrewKeys.some((key) => key === "")) return 0;
  const latinKeys = latinWords.map((part, index) => {
    if (part.length !== 1) return soundKey(latinSkeleton(part));
    const initial = soundKey(latinSkeleton(part));
    return initial === "" || hebrewKeys[index].startsWith(initial)
      ? hebrewKeys[index]
      : initial;
  });
  const hebrew = hebrewKeys.join("");
  let latin = latinKeys.join("");
  if (!hebrew.includes("h")) latin = latin.replace(/h/g, "");
  return bigramDice(hebrew, latin);
}

function firstNameMatches(hebrewName: string, latinWords: string[]): boolean {
  const firstHebrew = (hebrewName ?? "").trim().split(/\s+/u).find(Boolean) ??
    "";
  const hebrewKeys = [
    soundKey(buildHebrewSkeleton(firstHebrew, false, false)),
    soundKey(buildHebrewSkeleton(firstHebrew, true, false)),
    soundKey(buildHebrewSkeleton(firstHebrew, false, true)),
    soundKey(buildHebrewSkeleton(firstHebrew, true, true)),
  ].filter(Boolean);
  return latinWords.some((word) => {
    if (word.length === 1) {
      const initial = soundKey(latinSkeleton(word));
      return initial !== "" &&
        hebrewKeys.some((key) => key.startsWith(initial));
    }
    const latinKeys = [
      soundKey(latinSkeleton(word)),
      soundKey(silentGhLatinSkeleton(word)),
    ];
    return hebrewKeys.some((hebrew) =>
      latinKeys.some((latin) => {
        const comparableLatin = hebrew.includes("h")
          ? latin
          : latin.replace(/h/g, "");
        return bigramDice(hebrew, comparableLatin) >= 0.5;
      })
    );
  });
}

/** Latin name without single-letter initial tokens ("J.K." splits too). */
function withoutInitials(name: string): string | null {
  const tokens = (name ?? "").split(/[\s.]+/u).filter(Boolean);
  const kept = tokens.filter((token) =>
    !/^[A-Za-z]$/.test(token.normalize("NFKD").replace(/\p{M}/gu, ""))
  );
  return kept.length === 0 || kept.length === tokens.length
    ? null
    : kept.join(" ");
}

/**
 * Deterministic 0..1 score that a Hebrew-script name and a Latin-script name
 * are the same person; the maximum over `latinNames`. Empty input gives 0.
 */
export function nameSoundScore(
  hebrewName: string,
  latinNames: string[],
): number {
  hebrewName = stripHebrewPoints(hebrewName ?? "");
  const fullName = /\s/u.test(hebrewName.trim());
  const skeletons = [hebrewSkeleton(hebrewName)];
  if (fullName) {
    skeletons.push(
      buildHebrewSkeleton(hebrewName, true, false),
      buildHebrewSkeleton(hebrewName, false, true),
      buildHebrewSkeleton(hebrewName, true, true),
    );
  }
  const hebrewKeys = [...new Set(skeletons.map(soundKey))];
  if (hebrewKeys[0] === "" || !Array.isArray(latinNames)) return 0;
  // Alternate vowel/x readings and omitted h are for full names. Keeping
  // single-token description hits strict avoids short-name false positives.
  const allowOmittedH = fullName;
  let best = 0;
  const candidates: string[] = [];
  for (const name of latinNames) {
    candidates.push(name);
    const stripped = withoutInitials(name);
    if (stripped !== null) candidates.push(stripped);
  }
  for (const latin of candidates) {
    let latinBest = 0;
    const latinKeys = [
      soundKey(latinSkeleton(latin)),
      soundKey(silentGhLatinSkeleton(latin)),
    ];
    for (const hebrew of hebrewKeys) {
      for (const latinKey of latinKeys) {
        const comparableLatin = hebrew.includes("h") || !allowOmittedH
          ? latinKey
          : latinKey.replace(/h/g, "");
        const score = bigramDice(hebrew, comparableLatin);
        if (score > latinBest) latinBest = score;
      }
    }
    if (fullName) {
      for (
        const [vowelAwareVav, latinX] of [
          [false, false],
          [true, false],
          [false, true],
          [true, true],
        ]
      ) {
        const score = initialScore(hebrewName, latin, vowelAwareVav, latinX);
        if (score > latinBest) latinBest = score;
      }
    }
    const hebrewPartCount =
      (hebrewName ?? "").trim().split(/\s+/u).filter(Boolean).length;
    const latinWords = latinParts(latin);
    if (
      hebrewPartCount >= 2 && latinWords.length > hebrewPartCount &&
      !firstNameMatches(hebrewName, latinWords)
    ) {
      latinBest *= hebrewPartCount / latinWords.length;
    }
    if (latinBest > best) best = latinBest;
  }
  return best;
}
