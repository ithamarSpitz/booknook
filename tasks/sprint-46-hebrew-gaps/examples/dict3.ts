// Measure: one-sided (current) vs two-sided dictionary score on tonight's real right/wrong pairs.
import { dictionaryScore, wordForms } from "file:///C:/Users/itas1/torimitor/scripts/lib/dictionary.ts";
import { wiktionaryGlosses } from "file:///C:/Users/itas1/torimitor/supabase/functions/_shared/bridges.ts";
const cache = new Map<string, Promise<string[]>>();
const glosses = (w: string) => { if (!cache.has(w)) cache.set(w, wiktionaryGlosses(w).catch(() => [])); return cache.get(w)!; };
const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "with", "or", "at", "by", "from", "is"]);
const HE_STOP = new Set(["של", "על", "את", "עם", "אל", "גם", "כי", "או", "I", "II"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const covered = (word: string, joined: string) => {
  if (new RegExp(`\\b${esc(word)}\\b`, "i").test(joined)) return true;
  let stem = word.replace(/(?:ies|es|s|er|ing|ed)$/i, "");
  if (stem.length > 2 && stem.at(-1) === stem.at(-2)) stem = stem.slice(0, -1);
  return !!stem && new RegExp(`\\b${esc(stem)}[a-z]*`, "i").test(joined);
};
/** Share of Hebrew content words whose glosses cover some English content word. */
let contra: string[] = [];
async function hebrewSide(he: string, en: string): Promise<number> {
  contra = [];
  const enWords = (en.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w));
  const heWords = (he.match(/[\u0590-\u05ff']+/gu) ?? []).filter((w) => !HE_STOP.has(w));
  if (!heWords.length || !enWords.length) return 0;
  let hit = 0;
  for (const w of heWords) {
    let defs: string[] = [];
    for (const f of wordForms(w)) { defs = await glosses(f); if (defs.length) break; }
    const joined = defs.join(" ").toLowerCase();
    if (enWords.some((e) => covered(e, joined))) hit++;
    else if (defs.length) contra.push(`${w}=${defs.slice(0, 2).join("/").slice(0, 40)}`);
  }
  return hit / heWords.length;
}
const pairs: [string, string, boolean][] = [
  ["עיר הג'ינים", "City of Djinns", true], ["סם אהבה", "Love Medicine", true], ["מאדים האדום", "Red Mars", true],
  ["עשב", "Grass", true], ["בורות", "Ignorance", true], ["על הילד", "About a Boy", true], ["יומני הנסיכה", "The Princess Diaries", true],
  ["שער הניצחון", "Arch of Triumph", true], ["פחות מאפס", "Less Than Zero", true], ["עת לאהוב ועת למות", "A Time to Love and a Time to Die", true],
  ["על אהבה ושדים אחרים", "Of Love and Other Demons", true], ["מוות לסירוגין", "Death with Interruptions", true], ["על הפיקחון", "Seeing", true],
  ["מאדים הירוק", "Red Mars", false], ["מאדים הכחול I", "Red Mars", false], ["אהבה על הדשא", "About a Boy", false],
  ["הנסיכה באור הזרקורים", "The Princess Diaries", false], ["הנסיכה מאוהבת", "The Princess Diaries", false],
  ["הנסיכה מתגעגעת", "The Princess Diaries", false], ["הנסיכה מיה", "The Princess Diaries", false],
  ["זרע פרא", "Parable of the Sower", false], ["הכל למען האהבה", "A Good Person", false],
];
for (const [he, en, ok] of pairs) {
  const a = await dictionaryScore(he, en, glosses), b = await hebrewSide(he, en);
  console.log(ok ? "RIGHT" : "WRONG", "| en-side", a.toFixed(2), "| he-side", b.toFixed(2), "| contradicted:", contra.length, contra.join("; "), "|", he, "/", en);
}
