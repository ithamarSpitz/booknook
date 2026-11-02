-- English edition resolve_status and production mis-link cleanup (Simania 1013521 / Hardcover 372879).
alter type public.resolve_status add value if not exists 'hardcover';

update public.recommendations r
   set simania_id = null
  from public.works w
 where r.work_id = w.id
   and r.simania_id = 1013521
   and w.hardcover_id = 372879;

update public.editions e
   set work_id = null,
       resolve_status = 'not_found',
       resolved_at = now()
  from public.works w
 where e.work_id = w.id
   and e.simania_id = 1013521
   and w.hardcover_id = 372879;
