// Read-only: for each English-only used work, list ALL unlinked Simania books by the Hebrew author (paged),
// and bridge each one back to its original via NLI + Wikidata. A candidate whose original matches the English title = missed translation.
import { nliOriginal, wikidataOriginal, wikidataHebrewAuthor } from "file:///C:/Users/itas1/torimitor/supabase/functions/_shared/bridges.ts";
import { callTool, similarity, simaniaIdOf } from "file:///C:/Users/itas1/torimitor/public/js/simania.js";
import { nameSoundScore } from "file:///C:/Users/itas1/torimitor/supabase/functions/_shared/names.ts";
import { openProdDb } from "file:///C:/Users/itas1/torimitor/scripts/lib/prod-db.ts";
// Throttle Wikimedia: one request at a time, >=300ms apart; on 429 wait (retry-after or 15s) and retry up to 6 times.
const realFetch = globalThis.fetch; let wmChain: Promise<unknown> = Promise.resolve(); let wm429 = 0;
globalThis.fetch = ((input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (!/wikidata.org|wiktionary.org|wikipedia.org/.test(url)) return realFetch(input, init);
  const run = async () => {
    for (let a = 0; ; a++) {
      await new Promise((r) => setTimeout(r, 300));
      const res = await realFetch(input, init);
      if (res.status !== 429 || a >= 6) return res;
      wm429++; const ra = Number(res.headers.get("retry-after")); await res.body?.cancel();
      await new Promise((r) => setTimeout(r, (ra > 0 ? ra : 15) * 1000));
    }
  };
  const p = wmChain.then(run, run); wmChain = p.catch(() => {}); return p;
}) as typeof fetch;
addEventListener("unload", () => console.error("wm429", wm429));
const sql = await openProdDb({ readOnly: true });
const works = await sql`select w.id, w.hardcover_id, w.original_title, w.original_authors from public.works w where not exists (select 1 from public.editions e where e.work_id = w.id and e.simania_id > 0) order by md5(w.id::text) limit 5000 offset ${Number(Deno.args[0] ?? 0)}`;
const [tot] = await sql`select count(*) n, count(*) filter (where exists (select 1 from public.editions e where e.work_id = w.id and e.simania_id > 0)) linked from public.works w`;
console.log(JSON.stringify({ total_works: Number(tot.n), linked: Number(tot.linked) }));
const linked = new Set((await sql`select simania_id from public.editions where work_id is not null and simania_id > 0`).map((r) => Number(r.simania_id)));
await sql.end();
const strip = (t: string) => t.replace(/\(.*?\)|:.*$/g, "").replace(/^the\s+/i, "").trim();
async function authorBooks(he: string) {
  const w = he.trim().split(/\s+/); const q = w.length === 1 ? w[0] : `${w[0]} ${w[w.length - 1]}`;
  const out = new Map<number, string>();
  for (let off = 0; off < 300; off += 50) {
    const d: any = await callTool("books_search", { query: q, limit: 50, offset: off });
    const list = Array.isArray(d) ? d : (d?.books ?? d?.results ?? d?.items ?? d?.data ?? []);
    if (!list.length) break;
    for (const b of list) { const id = simaniaIdOf(b); if (id && /[\u0590-\u05FF]/.test(b.title ?? "") && similarity(he, b.author ?? "") >= 0.6) out.set(id, b.title); }
    if (list.length < 50) break;
  }
  return out;
}
const POOL = 2; let next = 0;
const linkMap: Record<string, string[]> = JSON.parse(Deno.readTextFileSync("C:/Users/itas1/AppData/Local/Temp/claude/9e4c3806fe07c20a/cfed4163-5c6f-412f-a919-affa7e4b90cb/scratchpad/authormap.json"));
const heCache = new Map<string, Promise<string[]>>();
function hebrewNames(en: string): Promise<string[]> {
  const k = en.trim().toLowerCase().replace(/s+/g, " ");
  if (!heCache.has(k)) heCache.set(k, (async () => {
    const out = new Set((linkMap[k] ?? []).filter((h) => nameSoundScore(h, [en]) >= 0.8));
    if (!out.size) { try { const w = await wikidataHebrewAuthor(en); if (w) out.add(w); } catch { /* */ } }
    return [...out];
  })());
  return heCache.get(k)!;
}
const booksCache = new Map<string, Promise<Map<number, string>>>();
const origCache = new Map<string, Promise<string[]>>();
function originals(title: string, he: string): Promise<string[]> {
  if (!origCache.has(title)) origCache.set(title, (async () => { const o: string[] = [];
    try { const n = await nliOriginal(title, he); if (n?.title) o.push(n.title); } catch { /* */ }
    try { const d = await wikidataOriginal(title); if (d?.title) o.push(d.title); } catch { /* */ }
    return o; })());
  return origCache.get(title)!;
}
async function one(w: any) {
  const en = w.original_title as string, author = (w.original_authors ?? [])[0] ?? "";
  const ev: Record<string, unknown> = { hc: w.hardcover_id, t: en, a: author };
  const hes = await hebrewNames(author); const he = hes[0] ?? null;
  ev.he = hes.length ? hes.join(" | ") : null;
  if (he) {
    try {
      const books = new Map<number, string>(); for (const h of hes) { if (!booksCache.has(h)) booksCache.set(h, authorBooks(h)); for (const [id, ti] of await booksCache.get(h)!) books.set(id, ti); } ev.all = books.size;
      const cands = [...books].filter(([id]) => !linked.has(id)); ev.unlinked = cands.length;
      const hits: string[] = [];
      for (const [id, title] of cands.slice(0, 60)) {
        const origs = await originals(title, he);
        const s = Math.max(0, ...origs.map((o) => Math.max(similarity(en, o), similarity(strip(en), strip(o)))));
        if (s >= 0.72) hits.push(`${id}:${title}<=${origs.join("|")}`);
      }
      ev.hits = hits;
    } catch (e) { ev.err = String(e).slice(0, 80); }
  }
  console.log(JSON.stringify(ev));
}
await Promise.all(Array.from({ length: POOL }, async () => { while (next < works.length) { const w = works[next++]; try { await one(w); } catch (e) { console.log(JSON.stringify({ hc: w.hardcover_id, t: w.original_title, err: String(e).slice(0, 80) })); } } }));
