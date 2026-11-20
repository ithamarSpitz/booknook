import { stripHebrewPoints } from "./simania.js";

const HEBREW_LETTERS = {
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
const HEBREW_GERESH = { "ג": "j", "צ": "ch", "ץ": "ch" };
const GERESH = new Set(["׳", "'", "’", "`"]);
const SOUND_CLASSES = {
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

/**
 * @param {string} name
 * @param {boolean} vowelAwareVav
 * @param {boolean} latinX
 * @returns {string}
 */
function buildHebrewSkeleton(name, vowelAwareVav, latinX) {
  const chars = Array.from(stripHebrewPoints(name));
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (next !== undefined && GERESH.has(next) && ch in HEBREW_GERESH) {
      out += HEBREW_GERESH[ch];
      i++;
      continue;
    }
    if (vowelAwareVav && ch === "ו") {
      if (next === "ו") {
        out += "v";
        i++;
      }
      continue;
    }
    if (latinX && ch === "ק" && next === "ס") {
      out += "x";
      i++;
      continue;
    }
    out += HEBREW_LETTERS[ch] ?? "";
  }
  return out;
}

/** @param {string} name @returns {string} */
export function hebrewSkeleton(name) {
  return buildHebrewSkeleton(name, false, false);
}

/** @param {string} name @returns {string} */
export function latinSkeleton(name) {
  return (name ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/ph/g, "f").replace(/th/g, "t")
    .replace(/tch/g, "ch")
    .replace(/ch/g, "k").replace(/sh/g, "s").replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s").replace(/[aeiouy]/g, "")
    .replace(/[^a-z]/g, "");
}

/** @param {string} name @returns {string} */
function silentGhLatinSkeleton(name) {
  return latinSkeleton((name ?? "").replace(/gh/gi, ""));
}

/** @param {string} skeleton @returns {string} */
function soundKey(skeleton) {
  skeleton = skeleton.replace(/ch/g, "k");
  let out = "";
  for (const ch of skeleton) {
    const cls = SOUND_CLASSES[ch];
    if (cls !== undefined && out[out.length - 1] !== cls) out += cls;
  }
  return out;
}

/** @param {string} text @returns {string[]} */
function bigrams(text) {
  const out = [];
  for (let i = 0; i + 1 < text.length; i++) out.push(text.slice(i, i + 2));
  return out;
}

/** @param {string} a @param {string} b @returns {number} */
function bigramDice(a, b) {
  if (a === "" || b === "") return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return a === b ? 1 : 0;
  const counts = new Map();
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

/** @param {string} name @returns {string[]} */
function latinParts(name) {
  return (name ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().match(/[a-z]+/g) ?? [];
}

/**
 * @param {string} hebrewName
 * @param {string} latinName
 * @param {boolean} vowelAwareVav
 * @param {boolean} latinX
 * @returns {number}
 */
function initialScore(hebrewName, latinName, vowelAwareVav, latinX) {
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

/**
 * @param {string} hebrewName
 * @param {string[]} latinWords
 * @returns {boolean}
 */
function firstNameMatches(hebrewName, latinWords) {
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

/** @param {string} hebrewName @param {string[]} latinNames @returns {number} */
export function nameSoundScore(hebrewName, latinNames) {
  hebrewName = stripHebrewPoints(hebrewName);
  const fullName = /\s/u.test((hebrewName ?? "").trim());
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
  for (const latin of latinNames) {
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
