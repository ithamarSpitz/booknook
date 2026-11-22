import { bookDetails } from "file:///C:/Users/itas1/torimitor/supabase/functions/_shared/simania.ts";
import { nliOriginal } from "file:///C:/Users/itas1/torimitor/supabase/functions/_shared/bridges.ts";
import { similarity } from "file:///C:/Users/itas1/torimitor/supabase/functions/_shared/utils.ts";
const rows = Deno.readTextFileSync(Deno.args[0]).trim().split(/\n/).map((l) => JSON.parse(l));
// deterministic sample: every 8th
const sample = rows;
const strip = (t: string) => t.replace(/\(.*?\)|:.*$/g, "").replace(/^the\s+/i, "").trim();
let agree = 0, differ = 0, unknown = 0;
for (const r of sample) {
  const d: any = await bookDetails(r.proposal.simania_id).catch(() => null);
  let o: any = null; try { o = await nliOriginal(String(d?.title ?? r.proposal.hebrew_title), String(d?.author ?? "")); } catch { o = "ERR"; }
  const t = o && o !== "ERR" ? o.title : null;
  const s = t ? Math.max(similarity(r.title, t), similarity(strip(r.title), strip(t))) : 0;
  const v = !t ? "UNKNOWN" : s >= 0.6 ? "AGREE" : "DIFFER";
  if (v === "AGREE") agree++; else if (v === "DIFFER") differ++; else unknown++;
  console.log(v, r.proposal.via, r.proposal.simania_id, r.hardcover_id, "|", r.title, "→", r.proposal.hebrew_title, "|", d?.author, "| NLI original:", t ?? o);
}
console.log(JSON.stringify({ sample: sample.length, agree, differ, unknown }));
