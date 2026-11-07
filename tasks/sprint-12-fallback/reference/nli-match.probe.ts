// Deterministic probe: English book -> Hebrew edition via NLI (search by the
// author's Latin authority name), then the same Hebrew edition on Simania.
// Read-only. Input: heb2.out (English-only rows of both readers).
import { callTool, normalize, simaniaIdOf, similarity } from "../../../public/js/simania.js";
import { nameSoundScore } from "../../../scripts/lib/names.ts";
import { nliHebrew, wikidataHebrew } from "../../../supabase/functions/_shared/bridges.ts";

const NLI = "https://nli.alma.exlibrisgroup.com/view/sru/972NNL_INST";
const HEB = /[\u0590-\u05FF]/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const mainTitle = (t: string) => t.replace(/\[[^\]]*\]/g, " ").split(/[:(]/)[0].replace(/\s+/g, " ").trim();
function dice(a: string, b: string) {
  const g = (s: string) => { const n = normalize(s).replace(/\s+/g, " "); const m = new Map<string, number>(); for (let i = 0; i < n.length - 1; i++) { const k = n.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const x = g(a), y = g(b); let common = 0, total = 0;
  for (const [k, v] of x) { common += Math.min(v, y.get(k) ?? 0); total += v; }
  for (const v of y.values()) total += v;
  return total ? (2 * common) / total : 0;
}
const titleMatch = (a: string, b: string) => similarity(mainTitle(a), mainTitle(b)) >= 0.8 || dice(mainTitle(a), mainTitle(b)) >= 0.85;

type Rec = { title: string; author: string; original: string };

function subfields(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`tag="${tag}"[^>]*>([\\s\\S]*?)</datafield>`, "g");
  for (const m of xml.matchAll(re)) {
    out.push([...m[1].matchAll(/code="[a-z]">([^<]*)</g)].map((s) => s[1]).join(" "));
  }
  return out;
}
const unxml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export async function nli(query: string): Promise<{ total: number; recs: Rec[] }> {
  const p = new URLSearchParams({ version: "1.2", operation: "searchRetrieve", query, maximumRecords: "100", recordSchema: "marcxml" });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const x = await (await fetch(`${NLI}?${p}`, { signal: AbortSignal.timeout(40000) })).text();
      const total = Number(x.match(/<numberOfRecords>(\d+)/)?.[1] ?? 0);
      const recs: Rec[] = [];
      for (const rec of x.split("<record ").slice(1)) {
        const t245 = unxml(subfields(rec, "245")[0] ?? "");
        if (!HEB.test(t245)) continue;
        const title = t245.split(" / ")[0].replace(/\[[^\]]*\]/g, "").replace(/[\s:/.;]+$/, "").trim();
        const a = unxml(subfields(rec, "100")[0] ?? "").replace(/,?\s*\d{4}-?(\d{4})?.*$/, "").replace(/\s*מחבר.*$/, "").trim();
        const author = a.includes(",") ? a.split(",").slice(0, 2).reverse().map((s) => s.trim()).join(" ") : a;
        const original = unxml(subfields(rec, "240")[0] ?? "").replace(/\.?\s*Hebrew\.?\s*$/i, "").trim();
        recs.push({ title, author, original });
      }
      return { total, recs };
    } catch { await sleep(2000); }
  }
  throw new Error("NLI failed");
}

export function authority(author: string): string {
  const parts = author.replace(/\s+/g, " ").trim().split(" ").filter((p) => !/^jr\.?$/i.test(p));
  return `${parts[parts.length - 1]}, ${parts[0]}`;
}
const clean = (s: string) => s.replace(/["\\]/g, " ").trim();

export async function findHebrew(title: string, author: string) {
  const creator = authority(author);
  const t = mainTitle(title);
  // 1) uniform title + creator (precise for prolific authors); 2) all of the creator's records.
  const lists: Rec[][] = [];
  let total = 0;
  try { lists.push((await nli(`alma.creator all "${clean(creator)}" AND alma.uniform_title all "${clean(t)}"`)).recs); } catch { /* */ }
  try { const r = await nli(`alma.creator all "${clean(creator)}"`); total = r.total; lists.push(r.recs); } catch { /* */ }
  const recs = lists.flat();
  // Rule A: the record's original (240) title matches.
  for (const r of recs) if (r.original && titleMatch(r.original, t)) return { rec: r, rule: "original-title", total };
  // Rule B: the Hebrew title is a transliteration of the English title.
  for (const r of recs) if (!r.original && nameSoundScore(r.title, [t]) >= 0.85) return { rec: r, rule: "transliteration", total };
  // Rule D: the record's original title equals the work's original-language title (Wikidata).
  const originals = await wikidataOriginalTitles(title, author);
  for (const r of recs) if (r.original && originals.some((o) => titleMatch(r.original, o))) return { rec: r, rule: "original-language-title", total };
  // Rule C: Wikidata's Hebrew title equals an NLI Hebrew title by this author.
  let wd: string | null = null;
  try { wd = (await wikidataHebrew(title, author))?.title ?? null; } catch { /* */ }
  if (wd) for (const r of recs) if (titleMatch(r.title, wd)) return { rec: r, rule: "wikidata-title", total };
  // Rules E/F: a Hebrew title from NLI's original-title index or from Wikidata, accepted
  // only if Simania has it under a name that sounds like the English author (checked later).
  let nliTitle: string | null = null;
  try { nliTitle = (await nliHebrew(title, author))?.title ?? null; } catch { /* */ }
  if (nliTitle) return { rec: { title: nliTitle, author: "", original: title }, rule: "nli-original-index", total, needSound: true };
  if (wd) return { rec: { title: wd, author: "", original: "" }, rule: "wikidata-title-on-simania", total, needSound: true };
  return { rec: null, rule: null, total };
}

const WD = "https://www.wikidata.org/w/api.php";
const UA = { "User-Agent": "BookNookProbe/1.0" };
async function wd(params: Record<string, string>) {
  return await (await fetch(`${WD}?${new URLSearchParams({ format: "json", ...params })}`, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
}
// All titles (P1476) and labels of the Wikidata work with this English title whose author matches.
async function wikidataOriginalTitles(title: string, author: string): Promise<string[]> {
  try {
    const s = await wd({ action: "wbsearchentities", search: mainTitle(title), language: "en", type: "item", limit: "6" });
    const ids = (s.search ?? []).map((x: any) => x.id);
    if (!ids.length) return [];
    const ents = (await wd({ action: "wbgetentities", ids: ids.join("|"), props: "labels|claims" })).entities ?? {};
    for (const id of ids) {
      const e = ents[id];
      const authorIds = (e?.claims?.P50 ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
      if (!authorIds.length) continue;
      const a = (await wd({ action: "wbgetentities", ids: authorIds.join("|"), props: "labels" })).entities ?? {};
      const names = Object.values(a).map((x: any) => x.labels?.en?.value ?? "").filter(Boolean);
      if (!names.some((n: string) => similarity(n, author) >= 0.5 || normalize(n).split(" ").pop() === normalize(author).split(" ").pop())) continue;
      const titles = (e.claims?.P1476 ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.text).filter(Boolean);
      const labels = Object.values(e.labels ?? {}).map((l: any) => l.value);
      return [...new Set([...titles, ...labels])].filter((x) => !HEB.test(x));
    }
  } catch { /* */ }
  return [];
}

const list = (d: any) => { const l = Array.isArray(d) ? d : (d?.books ?? d?.results ?? d?.items ?? d?.data ?? []); return Array.isArray(l) ? l : []; };
export async function onSimania(title: string, author: string, englishAuthor: string, needSound = false) {
  for (const q of [`${mainTitle(title)} ${author}`, mainTitle(title)]) {
    let books: any[] = [];
    try { books = list(await callTool("books_search", { query: q.trim(), limit: 10, offset: 0 })); } catch { /* */ }
    for (const b of books) {
      const id = simaniaIdOf(b);
      if (!id || id <= 0) continue;
      const ba = String(b.author ?? "");
      const sound = nameSoundScore(ba, [englishAuthor]) >= 0.7 || (author !== "" && normalize(author).split(" ").pop() === normalize(ba).split(" ").pop());
      if (needSound ? (titleMatch(title, String(b.title ?? "")) && sound) : titleMatch(title, String(b.title ?? "")) && (similarity(author, ba) >= 0.5 || nameSoundScore(ba, [englishAuthor]) >= 0.7 || normalize(author).split(" ").pop() === normalize(ba).split(" ").pop())) {
        return { id, title: String(b.title).trim(), author: String(b.author ?? "") };
      }
    }
    await sleep(300);
  }
  return null;
}

if (import.meta.main) {
const rows = (await Deno.readTextFile(Deno.args[0])).trim().split("\n").map((l) => JSON.parse(l));
const books = new Map<string, { title: string; author: string; who: Set<string> }>();
for (const r of rows) {
  const k = `${r.title}|${r.author}`;
  if (!books.has(k)) books.set(k, { title: r.title, author: r.author ?? "", who: new Set() });
  books.get(k)!.who.add(`${String(r.reader).slice(0, 4)}-${r.src === "reco page" ? "page" : "genre"}`);
}
for (const b of books.values()) {
  const h = await findHebrew(b.title, b.author);
  const s = h.rec ? await onSimania(h.rec.title, h.rec.author, b.author, (h as any).needSound === true) : null;
  console.log(JSON.stringify({ title: b.title, author: b.author, who: [...b.who].sort(), nliTotal: h.total, hebrew: h.rec?.title ?? null, hebAuthor: h.rec?.author ?? null, rule: h.rule, simania: s }));
  await sleep(500);
}
}
void normalize;
