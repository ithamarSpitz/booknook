alter table public.genre_recommendations
  add column because integer[] not null default '{}';

create or replace function public.replace_genre_recommendations(
  p_user_id uuid,
  p_rows jsonb
)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_work uuid;
  v_genre text;
  v_shelf_position numeric;
  v_position numeric;
  v_edition_numeric numeric;
  v_edition integer;
  v_score real;
  v_because_numeric numeric;
  v_because_id integer;
  v_because integer[];
  v_seen uuid[] := '{}';
  v_genres text[] := '{}';
  v_genre_counts integer[] := '{}';
  v_genre_index integer;
  v_generated_at timestamptz;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 60 then
    raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or not (v_row ?& array[
         'work_id', 'genre', 'shelf_position', 'position', 'simania_id', 'score'
       ])
       or v_row - array[
         'work_id', 'genre', 'shelf_position', 'position', 'simania_id', 'score',
         'because'
       ] <> '{}'::jsonb
       or jsonb_typeof(v_row->'work_id') <> 'string'
       or jsonb_typeof(v_row->'genre') <> 'string'
       or jsonb_typeof(v_row->'shelf_position') <> 'number'
       or jsonb_typeof(v_row->'position') <> 'number'
       or jsonb_typeof(v_row->'simania_id') not in ('number', 'null')
       or jsonb_typeof(v_row->'score') <> 'number'
       or (v_row ? 'because' and jsonb_typeof(v_row->'because') <> 'array') then
      raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
    end if;

    v_work := (v_row->>'work_id')::uuid;
    v_genre := v_row->>'genre';
    v_shelf_position := (v_row->>'shelf_position')::numeric;
    v_position := (v_row->>'position')::numeric;
    v_edition_numeric := (v_row->>'simania_id')::numeric;
    v_score := (v_row->>'score')::real;

    if nullif(btrim(v_genre), '') is null
       or v_shelf_position <> trunc(v_shelf_position)
       or v_shelf_position < 0 or v_shelf_position > 4
       or v_position <> trunc(v_position)
       or v_position < 0 or v_position > 11
       or (v_edition_numeric is not null
           and (v_edition_numeric <> trunc(v_edition_numeric)
                or v_edition_numeric < -2147483648
                or v_edition_numeric > 2147483647))
       or v_score in ('Infinity'::real, '-Infinity'::real, 'NaN'::real)
       or v_work = any(v_seen) then
      raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
    end if;

    v_because := '{}';
    if v_row ? 'because' then
      if jsonb_array_length(v_row->'because') > 10 then
        raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
      end if;
      for v_item in select value from jsonb_array_elements(v_row->'because') loop
        if jsonb_typeof(v_item) <> 'number' then
          raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
        end if;
        v_because_numeric := (v_item #>> '{}')::numeric;
        if v_because_numeric <> trunc(v_because_numeric)
           or v_because_numeric = 0
           or v_because_numeric < -2147483648
           or v_because_numeric > 2147483647 then
          raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
        end if;
        v_because_id := v_because_numeric::integer;
        if v_because_id = any(v_because) then
          raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
        end if;
        v_because := array_append(v_because, v_because_id);
      end loop;
    end if;

    v_edition := v_edition_numeric::integer;
    v_seen := array_append(v_seen, v_work);
    v_genre_index := array_position(v_genres, v_genre);
    if v_genre_index is null then
      if cardinality(v_genres) >= 5 then
        raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
      end if;
      v_genres := array_append(v_genres, v_genre);
      v_genre_counts := array_append(v_genre_counts, 1);
    else
      v_genre_counts[v_genre_index] := v_genre_counts[v_genre_index] + 1;
      if v_genre_counts[v_genre_index] > 12 then
        raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
      end if;
    end if;

    if not exists (select 1 from public.works where id = v_work)
       or (v_edition is not null and not exists (
         select 1 from public.editions where simania_id = v_edition
       )) then
      raise exception using errcode = '23503', message = 'catalog reference not found';
    end if;
    if v_edition is not null and not exists (
      select 1 from public.editions
       where simania_id = v_edition and work_id = v_work
    ) then
      raise exception using errcode = '22023', message = 'edition does not belong to work';
    end if;
  end loop;

  v_generated_at := clock_timestamp();
  delete from public.genre_recommendations where user_id = p_user_id;
  insert into public.genre_recommendations
    (user_id, work_id, genre, shelf_position, position, simania_id, score, because,
     generated_at)
  select p_user_id, r.work_id, r.genre, r.shelf_position, r.position,
         r.simania_id, r.score, coalesce(r.because, '{}'), v_generated_at
    from jsonb_to_recordset(p_rows) as r
      (work_id uuid, genre text, shelf_position smallint, position smallint,
       simania_id integer, score real, because integer[])
   where not exists (
     select 1
       from public.shelf_books sb
       join public.editions e on e.simania_id = sb.simania_id
      where sb.user_id = p_user_id and e.work_id = r.work_id
   );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
end;
$$;

revoke all on function public.replace_genre_recommendations(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_genre_recommendations(uuid, jsonb)
  to service_role;
