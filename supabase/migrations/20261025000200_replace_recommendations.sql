-- Publish the service-only, atomic replacement used by the Edge Function.
create function public.replace_recommendations(p_user_id uuid, p_rows jsonb)
returns setof public.recommendations
language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_work uuid;
  v_edition integer;
  v_score real;
  v_seen uuid[] := '{}';
  v_generated_at timestamptz;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;
  lock table public.recommendations in share row exclusive mode;
  v_generated_at := clock_timestamp();

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid recommendation payload';
  end if;
  if jsonb_array_length(p_rows) > 20 then
    raise exception using errcode = '22023', message = 'invalid recommendation payload';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid recommendation payload';
    end if;
    if not (v_row ?& array['work_id', 'simania_id', 'score', 'because', 'shared_tags'])
       or v_row - array['work_id', 'simania_id', 'score', 'because', 'shared_tags'] <> '{}'::jsonb
       or jsonb_typeof(v_row->'work_id') <> 'string'
       or jsonb_typeof(v_row->'simania_id') not in ('number', 'null')
       or jsonb_typeof(v_row->'score') <> 'number'
       or jsonb_typeof(v_row->'because') <> 'array'
       or jsonb_typeof(v_row->'shared_tags') <> 'array' then
      raise exception using errcode = '22023', message = 'invalid recommendation payload';
    end if;
    -- Convert only after checking JSON types; normalize cast/range errors below.
    v_work := (v_row->>'work_id')::uuid;
    v_edition := (v_row->>'simania_id')::integer;
    v_score := (v_row->>'score')::real;
    if v_score in ('Infinity'::real, '-Infinity'::real, 'NaN'::real)
       or v_work = any(v_seen) then
      raise exception using errcode = '22023', message = 'invalid recommendation payload';
    end if;
    v_seen := array_append(v_seen, v_work);
    for v_item in select value from jsonb_array_elements(v_row->'because') loop
      if jsonb_typeof(v_item) <> 'number' then
        raise exception using errcode = '22023', message = 'invalid recommendation payload';
      end if;
      perform (v_item #>> '{}')::integer;
    end loop;
    if exists (select 1 from jsonb_array_elements(v_row->'shared_tags') t
               where jsonb_typeof(t.value) <> 'string') then
      raise exception using errcode = '22023', message = 'invalid recommendation payload';
    end if;
    if not exists (select 1 from public.works where id = v_work)
       or (v_edition is not null and not exists (
         select 1 from public.editions where simania_id = v_edition)) then
      raise exception using errcode = '23503', message = 'catalog reference not found';
    end if;
    if v_edition is not null and not exists (
      select 1 from public.editions where simania_id = v_edition and work_id = v_work
    ) then
      raise exception using errcode = '22023', message = 'edition does not belong to work';
    end if;
  end loop;

  delete from public.recommendations where user_id = p_user_id and not dismissed;
  return query
    with inserted as (
      insert into public.recommendations
        (user_id, work_id, simania_id, score, because, shared_tags, dismissed, generated_at)
      select p_user_id, r.work_id, r.simania_id, r.score, r.because, r.shared_tags,
             false, v_generated_at
      from jsonb_to_recordset(p_rows) as r
        (work_id uuid, simania_id integer, score real, because integer[], shared_tags text[])
      where not exists (select 1 from public.recommendations d
                        where d.user_id = p_user_id and d.work_id = r.work_id and d.dismissed)
        and not exists (select 1 from public.shelf_books sb
                        join public.editions e on e.simania_id = sb.simania_id
                        where sb.user_id = p_user_id and e.work_id = r.work_id)
      returning *
    )
    select i.* from inserted i join public.works w on w.id = i.work_id
    order by i.score desc, w.hardcover_id asc;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid recommendation payload';
end;
$$;

revoke all on function public.replace_recommendations(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_recommendations(uuid, jsonb) to service_role;
