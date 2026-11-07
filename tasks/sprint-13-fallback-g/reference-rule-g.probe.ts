// Temporary probe (deleted after use): run the production fallback over every
// English-only book of both readers with the proposed stricter rule G:
//  - at least 3 name hits (and strictly more than the runner-up, as now)
//  - a Hebrew edition published before the English original scores 0
//  - catalog Hebrew authors drop tokens with Latin letters (MARC subfield junk)
// Prints every decision with its evidence. Read-only.
import { authors, findHardcoverBook, hardcoverBooks, hardcoverEnglishBooks } from "../supabase/functions/_shared/hardcover.ts";
import { hebrewCandidates } from "../supabase/functions/_shared/hebrew-candidates.ts";
import { localizeFallback } from "../public/js/recs.js";
import { nameSoundScore } from "../public/js/names.js";
import { fetchSimaniaPayload, searchBooks } from "../public/js/simania.js";
import { readEnvFile } from "./lib/prod-db.ts";

Deno.env.set("HARDCOVER_API_KEY", readEnvFile(Deno.env.get("BOOKNOOK_ENV_FILE")!).HARDCOVER_API_KEY);

// Proposed rule G v3 (probe-local).
const COMMON = new Set(("a about after again against all also always american amazon an and another any are around as at away back bad be became because become been before began being best better between big black book books british called came can canadian city come could day days dead did do does down during each early end english even ever every family far few find first for found four from gave get girl give go goes going good got great had has have he her here him his home hope house how hung i if in into is it its just keep kind know last left life like little live long look lost love made make man many may me men might more most mother much must my never new newsday next night no not now of off old on once one only or other our out over own people place post provided real right royal said same saw say see seemed she should simple since small so some something soon still such take than that the their them then there these they thing things think this those three through time to told too took two under until up us very want war was washington way we well went were western what when where which while who why will with without woman women world would year years yet york you young your times bestselling author novel award review publishers weekly kirkus goodreads booklist library journal").split(" "));
function tokens(desc: string): string[] {
  const out = new Set<string>();
  const norm = desc.replace(/[׳’`]/g, "'").replace(/[״]/g, '"');
  for (const w of norm.split(/[^א-ת'"]+/)) {
    const t = w.replace(/^['"]+|['"]+$/g, "");
    if (t.replace(/['"]/g, "").length < 3) continue;
    out.add(t);
    if (/^[והבלמשכ]/.test(t) && t.length > 3) out.add(t.slice(1));
  }
  return [...out];
}
const hitsOf = (names: string[], desc: string) => { const tk = tokens(desc); return names.filter((n) => tk.some((h) => nameSoundScore(h, [n]) >= 0.85)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows = (await Deno.readTextFile(Deno.args[0])).trim().split("\n").map((l) => JSON.parse(l));
const books = new Map<string, { title: string; author: string; who: Set<string> }>();
for (const r of rows) {
  const k = `${r.title}|${r.author}`;
  if (!books.has(k)) books.set(k, { title: r.title, author: r.author ?? "", who: new Set() });
  books.get(k)!.who.add(String(r.reader).slice(0, 4));
}

for (const spec of books.values()) {
  const out: Record<string, unknown> = { title: spec.title, author: spec.author, who: [...spec.who].sort() };
  try {
    const found = await findHardcoverBook(spec.title, spec.author, { requireAuthor: true });
    if (!found) { console.log(JSON.stringify({ ...out, error: "no hardcover" })); continue; }
    const [book] = await hardcoverBooks([found.id]);
    const [det] = await hardcoverEnglishBooks([found.id]);
    const author = authors(book)[0] ?? spec.author;
    const year = Number(det?.release_year ?? book?.release_year ?? 0) || null;
    const r = await hebrewCandidates({ title: book.title, author, description: det?.description ?? null });
    const candidates = r.candidates.map((c) => ({
      ...c,
      author: c.author ? c.author.split(/\s+/).filter((w) => !/[A-Za-z]/.test(w)).join(" ") : c.author,
    }));
    const rec = { work_id: "w", simania_id: null, title: book.title, author, english_only: true, hebrew_hint: null, hebrew_author: null };
    const meta = new Map<number, { title: string; year: number | null; hits: string[] }>();
    const deps = (cands: typeof candidates) => ({
      isCurrent: () => true,
      callFunction: async () => ({ work_id: "w", candidates: cands, english_names: r.english_names }),
      searchBooks: async (q: string, l?: number) => { await sleep(250); return await searchBooks(q, l); },
      fetchPayload: async (sid: number) => {
        const p = await fetchSimaniaPayload(sid);
        const hy = Number(p?.details?.year ?? 0) || null;
        const early = false;
        const desc = early ? "" : String(p?.details?.description ?? "");
        meta.set(sid, { title: String(p?.details?.title ?? ""), year: hy, hits: hitsOf(r.english_names.filter((n) => !COMMON.has(n.toLowerCase())), String(p?.details?.description ?? "")) });
        return early ? { ...p, details: { ...p?.details, description: "" } } : p;
      },
    });
    const nonG = await localizeFallback(rec, deps(candidates.filter((c) => c.rule !== "G")));
    if (nonG) {
      out.decision = nonG; out.rule = "A-F";
      out.hebrew = candidates.find((c) => c.rule !== "G")?.title;
    } else if (candidates.some((c) => c.rule === "G")) {
      await localizeFallback(rec, deps(candidates));
      const all = [...meta].map(([id, m]) => ({ id, ...m }));
      const scored = all.map((e) => ({ ...e, distinct: e.hits.filter((n) => !all.some((o) => o.id !== e.id && o.hits.includes(n))) }))
        .sort((a, b) => b.distinct.length - a.distinct.length);
      out.g_scored = scored.map((s) => `${s.id} ${s.title} distinct=${s.distinct.join("/")} all=${s.hits.join("/")}`);
      const top = scored[0];
      if (top && top.distinct.length >= 2 && (!scored[1] || top.distinct.length > scored[1].distinct.length)) { out.decision = top.id; out.rule = "G"; out.hebrew = top.title; }
    }
    out.english_year = year;
    out.english_names = r.english_names;
  } catch (e) {
    out.error = String(e).slice(0, 120);
  }
  console.log(JSON.stringify(out));
  await sleep(1000);
}
