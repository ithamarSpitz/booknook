alter table public.profiles
  add column genre_shelf_count smallint not null default 10
  constraint profiles_genre_shelf_count_check
    check (genre_shelf_count between 1 and 20);

alter table public.genre_recommendations
  add column genre_key text;

update public.genre_recommendations
   set genre_key = genre;

alter table public.genre_recommendations
  alter column genre_key set not null;

alter table public.genre_recommendations
  add constraint genre_recommendations_shelf_position_check
  check (shelf_position between 0 and 19);

revoke update (genre_shelf_count) on table public.profiles
  from public, anon, authenticated;

create table public.genre_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  genre_key text not null check (nullif(btrim(genre_key), '') is not null),
  label text not null check (nullif(btrim(label), '') is not null),
  state text not null check (state in ('pinned', 'hidden')),
  pin_order integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, genre_key),
  check ((state = 'pinned') = (pin_order is not null))
);

alter table public.genre_preferences enable row level security;

create policy genre_preferences_select_own on public.genre_preferences
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.genre_preferences from public, anon, authenticated;
grant all on table public.genre_preferences to service_role;
grant select on table public.genre_preferences to authenticated;

create table public.reader_genres (
  user_id uuid not null references auth.users(id) on delete cascade,
  genre_key text not null,
  label text not null,
  seed_count integer not null check (seed_count >= 0),
  candidate_count integer not null check (candidate_count >= 0),
  position smallint not null check (position between 0 and 99),
  generated_at timestamptz not null default now(),
  primary key (user_id, genre_key)
);

alter table public.reader_genres enable row level security;

create policy reader_genres_select_own on public.reader_genres
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.reader_genres from public, anon, authenticated;
grant all on table public.reader_genres to service_role;
grant select on table public.reader_genres to authenticated;

create function public.set_genre_preference(
  p_genre_key text,
  p_label text,
  p_state text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_pin_order integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if nullif(btrim(p_genre_key), '') is null
     or nullif(btrim(p_label), '') is null
     or p_state is null
     or p_state not in ('auto', 'pinned', 'hidden') then
    raise exception using errcode = '22023', message = 'invalid genre preference';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;

  if p_state = 'auto' then
    delete from public.genre_preferences
     where user_id = v_user_id and genre_key = p_genre_key;
    return;
  end if;

  if p_state = 'hidden' then
    insert into public.genre_preferences
      (user_id, genre_key, label, state, pin_order, updated_at)
    values
      (v_user_id, p_genre_key, p_label, 'hidden', null, clock_timestamp())
    on conflict (user_id, genre_key) do update
      set label = excluded.label,
          state = excluded.state,
          pin_order = null,
          updated_at = excluded.updated_at;
    return;
  end if;

  select pin_order into v_pin_order
    from public.genre_preferences
   where user_id = v_user_id
     and genre_key = p_genre_key
     and state = 'pinned';

  if v_pin_order is null then
    if (select count(*) from public.genre_preferences
         where user_id = v_user_id and state = 'pinned') >= 19 then
      raise exception using errcode = '22023', message = 'too many pinned genres';
    end if;
    select coalesce(max(pin_order) + 1, 0) into v_pin_order
      from public.genre_preferences
     where user_id = v_user_id and state = 'pinned';
  end if;

  insert into public.genre_preferences
    (user_id, genre_key, label, state, pin_order, updated_at)
  values
    (v_user_id, p_genre_key, p_label, 'pinned', v_pin_order, clock_timestamp())
  on conflict (user_id, genre_key) do update
    set label = excluded.label,
        state = excluded.state,
        pin_order = excluded.pin_order,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_genre_preference(text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_genre_preference(text, text, text)
  to authenticated;

create function public.set_genre_shelf_count(p_count integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception using errcode = '22023', message = 'invalid genre shelf count';
  end if;

  update public.profiles
     set genre_shelf_count = p_count
   where id = v_user_id;
  if not found then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;
end;
$$;

revoke all on function public.set_genre_shelf_count(integer)
  from public, anon, authenticated;
grant execute on function public.set_genre_shelf_count(integer)
  to authenticated;

create function public.replace_reader_genres(p_user_id uuid, p_rows jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_genre_key text;
  v_label text;
  v_seed_count numeric;
  v_candidate_count numeric;
  v_position numeric;
  v_genre_keys text[] := '{}';
  v_positions integer[] := '{}';
  v_generated_at timestamptz;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = '22023', message = 'invalid reader genre payload';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or not (v_row ?& array[
         'genre_key', 'label', 'seed_count', 'candidate_count', 'position'
       ])
       or v_row - array[
         'genre_key', 'label', 'seed_count', 'candidate_count', 'position'
       ] <> '{}'::jsonb
       or jsonb_typeof(v_row->'genre_key') <> 'string'
       or jsonb_typeof(v_row->'label') <> 'string'
       or jsonb_typeof(v_row->'seed_count') <> 'number'
       or jsonb_typeof(v_row->'candidate_count') <> 'number'
       or jsonb_typeof(v_row->'position') <> 'number' then
      raise exception using errcode = '22023', message = 'invalid reader genre payload';
    end if;

    v_genre_key := v_row->>'genre_key';
    v_label := v_row->>'label';
    v_seed_count := (v_row->>'seed_count')::numeric;
    v_candidate_count := (v_row->>'candidate_count')::numeric;
    v_position := (v_row->>'position')::numeric;

    if nullif(btrim(v_genre_key), '') is null
       or nullif(btrim(v_label), '') is null
       or v_seed_count <> trunc(v_seed_count)
       or v_seed_count < 0 or v_seed_count > 2147483647
       or v_candidate_count <> trunc(v_candidate_count)
       or v_candidate_count < 0 or v_candidate_count > 2147483647
       or v_position <> trunc(v_position)
       or v_position < 0 or v_position > 99
       or v_genre_key = any(v_genre_keys)
       or v_position::integer = any(v_positions) then
      raise exception using errcode = '22023', message = 'invalid reader genre payload';
    end if;

    v_genre_keys := array_append(v_genre_keys, v_genre_key);
    v_positions := array_append(v_positions, v_position::integer);
  end loop;

  v_generated_at := clock_timestamp();
  delete from public.reader_genres where user_id = p_user_id;
  insert into public.reader_genres
    (user_id, genre_key, label, seed_count, candidate_count, position, generated_at)
  select p_user_id, r.genre_key, r.label, r.seed_count, r.candidate_count,
         r.position, v_generated_at
    from jsonb_to_recordset(p_rows) as r
      (genre_key text, label text, seed_count integer, candidate_count integer,
       position smallint);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid reader genre payload';
end;
$$;

revoke all on function public.replace_reader_genres(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_reader_genres(uuid, jsonb)
  to service_role;

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
  v_genre_key text;
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
  v_genre_keys text[] := '{}';
  v_genre_counts integer[] := '{}';
  v_genre_index integer;
  v_generated_at timestamptz;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 240 then
    raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or not (v_row ?& array[
         'work_id', 'genre_key', 'genre', 'shelf_position', 'position',
         'simania_id', 'score'
       ])
       or v_row - array[
         'work_id', 'genre_key', 'genre', 'shelf_position', 'position',
         'simania_id', 'score', 'because'
       ] <> '{}'::jsonb
       or jsonb_typeof(v_row->'work_id') <> 'string'
       or jsonb_typeof(v_row->'genre_key') <> 'string'
       or jsonb_typeof(v_row->'genre') <> 'string'
       or jsonb_typeof(v_row->'shelf_position') <> 'number'
       or jsonb_typeof(v_row->'position') <> 'number'
       or jsonb_typeof(v_row->'simania_id') not in ('number', 'null')
       or jsonb_typeof(v_row->'score') <> 'number'
       or (v_row ? 'because' and jsonb_typeof(v_row->'because') <> 'array') then
      raise exception using errcode = '22023', message = 'invalid genre recommendation payload';
    end if;

    v_work := (v_row->>'work_id')::uuid;
    v_genre_key := v_row->>'genre_key';
    v_genre := v_row->>'genre';
    v_shelf_position := (v_row->>'shelf_position')::numeric;
    v_position := (v_row->>'position')::numeric;
    v_edition_numeric := (v_row->>'simania_id')::numeric;
    v_score := (v_row->>'score')::real;

    if nullif(btrim(v_genre_key), '') is null
       or nullif(btrim(v_genre), '') is null
       or v_shelf_position <> trunc(v_shelf_position)
       or v_shelf_position < 0 or v_shelf_position > 19
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
    v_genre_index := array_position(v_genre_keys, v_genre_key);
    if v_genre_index is null then
      v_genre_keys := array_append(v_genre_keys, v_genre_key);
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
    (user_id, work_id, genre_key, genre, shelf_position, position, simania_id,
     score, because, generated_at)
  select p_user_id, r.work_id, r.genre_key, r.genre, r.shelf_position, r.position,
         r.simania_id, r.score, coalesce(r.because, '{}'), v_generated_at
    from jsonb_to_recordset(p_rows) as r
      (work_id uuid, genre_key text, genre text, shelf_position smallint,
       position smallint, simania_id integer, score real, because integer[])
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
