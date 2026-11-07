// Rule G probe: pick the author's Hebrew edition whose Simania description shares
// character names (by sound) with the English Hardcover description.
import { authority, nli, onSimania } from "./nli-match.probe.ts";
import { nameSoundScore } from "../../../scripts/lib/names.ts";
import { fetchSimaniaPayload } from "../../../public/js/simania.js";
import { readEnvFile } from "../../../scripts/lib/prod-db.ts";

const KEY = readEnvFile(Deno.env.get("BOOKNOOK_ENV_FILE") ?? "").HARDCOVER_API_KEY.replace(/^Bearer\s+/i, "");
const BOOKS = [
  ["Grass", "Sheri S. Tepper"], ["Stories of Your Life and Others", "Ted Chiang"], ["Girl in Landscape", "Jonathan Lethem"],
  ["Small Island", "Andrea Levy"], ["Never Lie", "Freida McFadden"],
];
const STOP = new Set("The A An And But When After Before Now In On At Of For From With Without This That These Those Her His Their Its It As If Yet So Then There Here New York Times Book Review Bestselling Author Novel Award One Two Three First Last".split(" "));

async function hcDescription(title: string, author: string): Promise<string> {
  const q = `query { books(where:{title:{_eq:${JSON.stringify(title)}}}, order_by:{users_read_count:desc}, limit:5) { title description cached_contributors } }`;
  const d = await (await fetch("https://api.hardcover.app/v1/graphql", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify({ query: q }) })).json();
  for (const b of d.data?.books ?? []) if (JSON.stringify(b.cached_contributors ?? "").includes(author.split(" ").pop()!)) return b.description ?? "";
  return "";
}
function englishNames(desc: string): string[] {
  const out = new Set<string>();
  for (const m of desc.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,})\b/g)) if (!STOP.has(m[1])) out.add(m[1]);
  return [...out];
}
function hebrewTokens(desc: string): string[] {
  const out = new Set<string>();
  for (const w of desc.split(/[^\u05D0-\u05EA'"׳״-]+/)) {
    const t = w.replace(/^[-'"]+|[-'"]+$/g, "");
    if (t.length < 3) continue;
    out.add(t);
    if (/^[והבלמשכ]/.test(t) && t.length > 3) out.add(t.slice(1));
  }
  return [...out];
}

for (const [title, author] of BOOKS) {
  const en = englishNames(await hcDescription(title, author));
  const recs = (await nli(`alma.creator all "${authority(author)}"`)).recs.filter((r) => !r.original);
  const scored = [];
  for (const r of recs) {
    const s = await onSimania(r.title, r.author, author);
    if (!s) continue;
    const desc = String((await fetchSimaniaPayload(s.id))?.details?.description ?? "");
    const he = hebrewTokens(desc);
    const hits = en.filter((n) => he.some((h) => nameSoundScore(h, [n]) >= 0.85));
    scored.push({ simania: `${s.id} ${s.title}`, hits });
  }
  scored.sort((a, b) => b.hits.length - a.hits.length);
  const ok = scored[0] && scored[0].hits.length >= 2 && (!scored[1] || scored[0].hits.length > scored[1].hits.length);
  console.log(JSON.stringify({ title, english_names: en.slice(0, 12), pick: ok ? scored[0] : null, candidates: scored }));
}
