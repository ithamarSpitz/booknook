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

/** @param {string} name @returns {string} */
export function hebrewSkeleton(name) {
  const chars = Array.from(name ?? "");
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (next !== undefined && GERESH.has(next) && ch in HEBREW_GERESH) {
      out += HEBREW_GERESH[ch];
      i++;
      continue;
    }
    out += HEBREW_LETTERS[ch] ?? "";
  }
  return out;
}

/** @param {string} name @returns {string} */
export function latinSkeleton(name) {
  return (name ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/ph/g, "f").replace(/th/g, "t")
    .replace(/ch/g, "k").replace(/sh/g, "s").replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s").replace(/[aeiouy]/g, "")
    .replace(/[^a-z]/g, "");
}

/** @param {string} skeleton @returns {string} */
function soundKey(skeleton) {
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

/** @param {string} hebrewName @param {string[]} latinNames @returns {number} */
export function nameSoundScore(hebrewName, latinNames) {
  const hebrew = soundKey(hebrewSkeleton(hebrewName));
  if (hebrew === "" || !Array.isArray(latinNames)) return 0;
  let best = 0;
  for (const latin of latinNames) {
    const score = bigramDice(hebrew, soundKey(latinSkeleton(latin)));
    if (score > best) best = score;
  }
  return best;
}
