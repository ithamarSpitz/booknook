import { nameSoundScore } from "./names.ts";
import type { SimaniaBook } from "./simania.ts";

export type SearchBooks = (
  query: string,
  limit: number,
  offset: number,
) => Promise<SimaniaBook[]>;

const FINAL: Record<string, string> = {
  "מ": "ם",
  "נ": "ן",
  "פ": "ף",
  "צ": "ץ",
  "כ": "ך",
};

// First alternative = most likely; cost = alternative index.
const RULES: [RegExp, string[]][] = [
  [/^mc/, ["מק"]],
  [/^ew/, ["יו", "ו"]],
  [/^oe/, ["וי", "ו"]],
  [/^sch/, ["ש"]],
  [/^tch/, ["צ'"]],
  [/^sh/, ["ש"]],
  [/^ch/, ["צ'", "ק", "כ~"]],
  [/^th/, ["ת", "ט"]],
  [/^ph/, ["פ", "ב"]],
  [/^ck/, ["ק"]],
  [/^gh/, [""]],
  [/^qu/, ["קוו", "קו"]],
  [/^kn/, ["נ"]],
  [/^ee|^ea|^ie/, ["י"]],
  [/^oo|^ou/, ["ו"]],
  [/^ay|^ai|^ey|^ei/, ["יי", "י"]],
  [/^au|^aw/, ["או", "ו"]],
  [/^ow/, ["או", "ו"]],
  [/^oa/, ["ו"]],
  [/^a/, ["א", ""]],
  [/^e/, ["", "י"]],
  [/^i/, ["י", ""]],
  [/^o/, ["ו", "או~"]],
  [/^u/, ["ו", "", "יו~"]],
  [/^y/, ["י"]],
  [/^b/, ["ב"]],
  [/^c(?=[eiy])/, ["ס"]],
  [/^c/, ["ק"]],
  [/^d/, ["ד"]],
  [/^f/, ["פ"]],
  [/^g(?=[eiy])/, ["ג'", "ג"]],
  [/^g/, ["ג"]],
  [/^h/, ["ה", ""]],
  [/^ts|^tz/, ["צ"]],
  [/^j/, ["ג'"]],
  [/^k/, ["ק", "כ"]],
  [/^l/, ["ל"]],
  [/^m/, ["מ"]],
  [/^n/, ["נ"]],
  [/^p/, ["פ"]],
  [/^r/, ["ר"]],
  [/^s/, ["ס", "ש~"]],
  [/^t/, ["ט"]],
  [/^v/, ["ב", "וו", "ו"]],
  [/^w/, ["ו", "וו"]],
  [/^x/, ["קס"]],
  [/^z/, ["ז"]],
];

export function hebrewSpellings(word: string, max = 6): string[] {
  let w = word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z]/g, "");
  w = w.replace(/([bcdfgklmnprstz])\1/g, "$1");
  let states: [string, number][] = [["", 0]];
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    const rule = RULES.find(([re]) => re.test(rest));
    if (!rule) {
      i++;
      continue;
    }
    const len = rest.match(rule[0])![0].length;
    let alts = rule[1];
    if (i === 0 && /^[aeiou]/.test(rest)) {
      alts = alts.map((a) => a.startsWith("א") ? a : "א" + a);
    }
    if (i + len === w.length && rest === "e") alts = [""];
    if (i + len === w.length && rest === "a" && i > 0) {
      alts = ["ה", "א"];
    }
    const next = new Map<string, number>();
    for (const [s, c] of states) {
      alts.forEach((a0, k) => {
        const rare = a0.endsWith("~");
        const v = s + (rare ? a0.slice(0, -1) : a0);
        next.set(v, Math.min(next.get(v) ?? 99, c + k + (rare ? 2 : 0)));
      });
    }
    states = [...next].sort((x, y) => x[1] - y[1]).slice(0, 60);
    i += len;
  }
  const fin = (s: string) =>
    s.replace(/(.)('?)$/, (_m, c, g) => (FINAL[c] ?? c) + g);
  const out: string[] = [];
  for (const [s] of states) {
    const f = fin(s);
    out.push(f);
    if (f.includes("'")) out.push(fin(f.replace(/'/g, "")));
  }
  return [...new Set(out.filter((s) => s.length >= 2))].slice(0, max);
}

function variants(n: string): string[] {
  const a = n.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const b = n.replace(/(\S+)\s*\(([^)]*)\)/g, "$2").replace(/\s+/g, " ")
    .trim();
  return [...new Set([a, b])].filter(Boolean);
}

const normHe = (s: string) =>
  s.replace(/[\u0591-\u05C7]/g, "").replace(/[\u05F3\u2019]/g, "'")
    .replace(/[-\u05BE]/g, " ").replace(/\s+/g, " ").trim();
const isInitials = (w: string) =>
  w.includes(".") && w.replace(/\./g, "").length <= 2;
const tokens = (s: string) =>
  s.split(/\s+/).filter((t) => t.replace(/[.'"]/g, "").length > 1);
const enTokens = (s: string) =>
  tokens(s.replace(/-/g, " ")).filter((w) => !isInitials(w));
const PARTICLE_EN = /^(di|de|du|da|le|la|van|von|del)(?=[a-z]{3,})/i;
const PARTICLE_HE = /^(די|דה|דו|דא|לה|לא|ואן|ון|פון|דל)$/;
const bare = (s: string) =>
  s.replace(/['׳"]/g, "").replace(
    /[םןףץך]/g,
    (c) =>
      ({ "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ", "ך": "כ" } as Record<
        string,
        string
      >)[c],
  );
const exactSet = (enLast: string) =>
  new Set(hebrewSpellings(enLast, 60).map(bare));

/** Surname spellings, plus "particle rest" forms for DiCamillo-like names. */
export function surnameSpellings(enLast: string, max = 6): string[] {
  const out = hebrewSpellings(enLast, max);
  const m = enLast.match(PARTICLE_EN);
  if (m) {
    const p = hebrewSpellings(m[1], 1)[0];
    const r = hebrewSpellings(enLast.slice(m[1].length), 3);
    r.forEach((x, i) => out.splice(1 + 2 * i, 0, `${p} ${x}`));
  }
  return [...new Set(out)].slice(0, max);
}

/** Last name and first name must both sound alike, and so must the pair. */
function sameName(he: string, en: string): number {
  const et = enTokens(en);
  if (!et.length) return 0;
  // English initials before the surname ("A.J. Finn") need Hebrew initials too.
  const enInitials = en.split(/\s+/).slice(0, -1).some(isInitials);
  const lastPart = (h: string, e: string) =>
    nameSoundScore(`סטיבן ${h}`, [`Stephen ${e}`]);
  const firstPart = (h: string, e: string) =>
    nameSoundScore(`${h} קינג`, [`${e} King`]);
  let best = 0;
  for (const v0 of variants(he)) {
    const raw = normHe(v0).split(/\s+/).filter(Boolean);
    let ht = tokens(normHe(v0));
    if (ht.length >= 3 && PARTICLE_HE.test(ht[ht.length - 2])) {
      ht = [
        ...ht.slice(0, -2),
        ht[ht.length - 2] + ht[ht.length - 1],
      ];
    }
    if (!ht.length) continue;
    const exact = bare(ht[ht.length - 1]).length >= 3 &&
      exactSet(et[et.length - 1]).has(bare(ht[ht.length - 1]));
    const last = exact ? 1 : lastPart(ht[ht.length - 1], et[et.length - 1]);
    if (last < 0.9) continue;
    if (et.length === 1) {
      if (last < 0.95) continue;
      if (!enInitials) {
        if (ht.length === 1) best = Math.max(best, last);
        continue;
      }
      const heInitials = raw.slice(0, -1).some((w) =>
        /[."']/.test(w) && w.replace(/[."']/g, "").length <= 2
      );
      if (heInitials) best = Math.max(best, last);
      continue;
    }
    if (ht.length < 2) continue;
    const middleHe = ht.slice(1, -1);
    const middleEn = et.slice(1, -1);
    // If both sides spell out middle names, each English one must be there.
    if (
      middleHe.length && middleEn.length &&
      !middleEn.every((m) => middleHe.some((h) => lastPart(h, m) >= 0.9))
    ) continue;
    for (const h of ht.slice(0, -1)) {
      const first = firstPart(h, et[0]);
      if (exact) {
        // The app's scorer is loose on first names (it rates בריאן ≈ Veronica),
        // so an exactly spelled surname needs an exactly spelled first name,
        // or a strong full-name score.
        const firstExact = bare(h).length >= 2 &&
          exactSet(et[0]).has(bare(h));
        const pairE = nameSoundScore(`${h} ${ht[ht.length - 1]}`, [
          `${et[0]} ${et[et.length - 1]}`,
        ]);
        if (firstExact || (first >= 0.95 && pairE >= 0.9)) {
          best = Math.max(best, 1);
        }
        continue;
      }
      if (first < 0.9) continue;
      const pair = nameSoundScore(`${h} ${ht[ht.length - 1]}`, [
        `${et[0]} ${et[et.length - 1]}`,
      ]);
      if (pair >= 0.85 && (last >= 0.95 || pair >= 0.95)) {
        best = Math.max(best, pair);
      }
    }
  }
  return best;
}

export function sameAuthor(hebrewName: string, englishName: string): boolean {
  return sameName(hebrewName, englishName) > 0;
}

export async function hebrewAuthorBySound(
  englishName: string,
  searchBooks: SearchBooks,
): Promise<string | null> {
  const et = enTokens(englishName);
  if (!et.length) return null;
  const lastS = surnameSpellings(et[et.length - 1], 6);
  if (!lastS.length) return null;
  const firstS = et.length > 1 ? hebrewSpellings(et[0], 4) : [];
  const plan: [string, number][] = [];
  // Full names first (precise), then each surname spelling alone (Simania
  // matches prefixes).
  for (const f of firstS) {
    for (const l of lastS.slice(0, 2)) plan.push([`${f} ${l}`, 0]);
  }
  for (const l of lastS) plan.push([l, 0]);
  for (const l of lastS.slice(2)) {
    if (firstS[0]) plan.push([`${firstS[0]} ${l}`, 0]);
  }
  plan.push([lastS[0], 50]);
  // Simania treats ' and ׳ as different characters: send both.
  const queries = plan.filter(([q]) => typeof q === "string" && q)
    .slice(0, 20)
    .flatMap(([query, offset]) =>
      (query.includes("'")
        ? [[query, offset], [query.replace(/'/g, "׳"), offset]]
        : [[query, offset]]) as [string, number][]
    )
    .slice(0, 26);
  const counts = new Map<string, { n: number; score: number }>();
  const seen = new Set<number>();
  for (const [query, offset] of queries) {
    const list = await searchBooks(query, 50, offset);
    for (const book of list) {
      const id = Number(book.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      const author = String(book.author ?? "").trim();
      if (!/[א-ת]/.test(author)) continue;
      // Whole comma-separated names too: splitting on " ו" ("and") alone
      // would cut surnames that start with ו (וולטון).
      const parts = new Set([
        ...author.split(/\s*[,،]\s*|\s+ו(?=[א-ת])/),
        ...author.split(/\s*,\s*/),
      ]);
      for (const part of parts) {
        const score = sameName(part, englishName);
        if (!score) continue;
        const key = variants(part)[0];
        const count = counts.get(key) ?? { n: 0, score: 0 };
        count.n++;
        count.score = Math.max(count.score, score);
        counts.set(key, count);
      }
    }
  }
  const ranked = [...counts].sort((x, y) =>
    y[1].n - x[1].n || y[1].score - x[1].score
  );
  return ranked[0]?.[0] ?? null;
}
