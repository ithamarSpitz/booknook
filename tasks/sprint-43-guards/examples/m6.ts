import {openProdDb} from "file:///C:/Users/itas1/torimitor/scripts/lib/prod-db.ts";
const s=await openProdDb({readOnly:true});
const r = await s`with used as (
  select work_id, simania_id from public.recommendations where work_id is not null
  union all select work_id, simania_id from public.genre_recommendations where work_id is not null
  union all select e.work_id, e.simania_id from public.shelf_books sb join public.editions e on e.simania_id=sb.simania_id where e.work_id is not null),
 w as (select work_id, coalesce(bool_or(coalesce(simania_id,0) > 0), false) shown_he from used group by work_id)
 select x.original_title t from w join public.works x on x.id=w.work_id where not shown_he and not exists (select 1 from public.editions e where e.work_id=w.work_id and e.simania_id>0) order by 1`;
for (const x of r) console.log(x.t);
await s.end();
