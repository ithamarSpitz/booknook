create extension if not exists pgcrypto;

create type public.shelf_kind as enum ('reading', 'read', 'want', 'stopped', 'custom');
create type public.resolve_status as enum ('pending', 'wikidata', 'nli', 'fuzzy', 'llm', 'not_found');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  locale text not null default 'he',
  created_at timestamptz not null default now()
);

create table public.works (
  id uuid primary key default gen_random_uuid(),
  hardcover_id integer unique,
  original_title text not null,
  original_authors text[] not null default '{}',
  similar_ids integer[] not null default '{}',
  tags jsonb not null default '{}',
  hardcover_cover_url text,
  refreshed_at timestamptz
);

create table public.editions (
  simania_id integer primary key,
  work_id uuid references public.works(id),
  resolve_status public.resolve_status not null default 'pending',
  resolved_at timestamptz,
  title text not null,
  author text,
  translator text,
  publisher text,
  series text,
  category text,
  year integer,
  pages integer,
  description text,
  cover_url text,
  simania_rating numeric(3,2),
  simania_rating_count integer,
  details_at timestamptz
);
create index editions_work_id_idx on public.editions(work_id);

create table public.shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind public.shelf_kind not null default 'custom',
  position integer not null,
  created_at timestamptz not null default now(),
  constraint shelves_user_position_key unique (user_id, position)
    deferrable initially deferred
);
create unique index shelves_user_builtin_kind_key
  on public.shelves(user_id, kind) where kind <> 'custom';

create table public.shelf_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  simania_id integer not null references public.editions(simania_id),
  shelf_id uuid not null references public.shelves(id) on delete cascade,
  position integer not null,
  added_at timestamptz not null default now(),
  finished_at timestamptz,
  rating smallint check (rating between 1 and 5),
  primary key (user_id, simania_id),
  constraint shelf_books_shelf_position_key unique (shelf_id, position)
    deferrable initially deferred
);

create table public.recommendations (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id uuid not null references public.works(id),
  simania_id integer references public.editions(simania_id),
  score real not null,
  because integer[] not null,
  shared_tags text[] not null default '{}',
  dismissed boolean not null default false,
  generated_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

create table public.search_cache (
  query_norm text primary key,
  results jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.editions enable row level security;
alter table public.shelves enable row level security;
alter table public.shelf_books enable row level security;
alter table public.recommendations enable row level security;
alter table public.search_cache enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy works_select_authenticated on public.works
  for select to authenticated using (true);
create policy editions_select_authenticated on public.editions
  for select to authenticated using (true);

create policy shelves_select_own on public.shelves
  for select to authenticated using (user_id = auth.uid());
create policy shelves_insert_custom on public.shelves
  for insert to authenticated with check (user_id = auth.uid() and kind = 'custom');
create policy shelves_update_own on public.shelves
  for update to authenticated using (user_id = auth.uid() and kind = 'custom')
  with check (user_id = auth.uid() and kind = 'custom');
create policy shelves_delete_own on public.shelves
  for delete to authenticated using (user_id = auth.uid());

create policy shelf_books_select_own on public.shelf_books
  for select to authenticated using (user_id = auth.uid());
create policy shelf_books_insert_own on public.shelf_books
  for insert to authenticated with check (user_id = auth.uid());
create policy shelf_books_update_own on public.shelf_books
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shelf_books_delete_own on public.shelf_books
  for delete to authenticated using (user_id = auth.uid());

create policy recommendations_select_own on public.recommendations
  for select to authenticated using (user_id = auth.uid());
create policy recommendations_update_own on public.recommendations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on table public.profiles, public.works, public.editions, public.shelves,
  public.shelf_books, public.recommendations, public.search_cache from public, anon, authenticated;
grant all on table public.profiles, public.works, public.editions, public.shelves,
  public.shelf_books, public.recommendations, public.search_cache to service_role;
grant select on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;
grant select on public.works, public.editions to authenticated;
grant select, insert on public.shelves to authenticated;
grant update (name) on public.shelves to authenticated;
grant select on public.shelf_books to authenticated;
grant insert (user_id, simania_id, shelf_id) on public.shelf_books to authenticated;
grant select on public.recommendations to authenticated;
grant update (dismissed) on public.recommendations to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := new.raw_user_meta_data ->> 'display_name';
  if nullif(btrim(v_name), '') is null then
    v_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;

  insert into public.profiles (id, display_name, locale)
  values (new.id, v_name, 'he');

  insert into public.shelves (user_id, name, kind, position) values
    (new.id, 'קורא עכשיו', 'reading', 0),
    (new.id, 'קראתי', 'read', 1),
    (new.id, 'רוצה לקרוא', 'want', 2),
    (new.id, 'הפסקתי', 'stopped', 3);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.prepare_custom_shelf_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'custom' then
    if auth.uid() is null then
      raise insufficient_privilege using message = 'authentication required';
    end if;
    if new.user_id <> auth.uid() then
      raise no_data_found using message = 'shelf not found';
    end if;
    perform 1 from public.profiles where id = auth.uid() for update;
    if not found then
      raise no_data_found using message = 'profile not found';
    end if;
    select count(*)::integer into new.position
      from public.shelves where user_id = auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_custom_shelf_insert() from public, anon, authenticated;
create trigger shelves_prepare_custom_insert
before insert on public.shelves
for each row execute function public.prepare_custom_shelf_insert();

create or replace function public.protect_shelf_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind then
    raise exception using errcode = '22023', message = 'shelf identity and kind are immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_shelf_update() from public, anon, authenticated;
create trigger shelves_protect_update before update on public.shelves
for each row execute function public.protect_shelf_update();

create or replace function public.protect_default_shelf_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.kind <> 'custom' and exists (select 1 from auth.users where id = old.user_id) then
    raise exception using errcode = '22023', message = 'default shelves cannot be deleted';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_default_shelf_delete() from public, anon, authenticated;
create trigger shelves_protect_default_delete before delete on public.shelves
for each row execute function public.protect_default_shelf_delete();

create or replace function public.prepare_shelf_book_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.shelf_kind;
  v_work_id uuid;
begin
  if auth.uid() is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if new.user_id <> auth.uid() then
    raise no_data_found using message = 'shelf not found';
  end if;

  perform 1 from public.profiles where id = auth.uid() for update;
  if not found then
    raise no_data_found using message = 'profile not found';
  end if;

  select kind into v_kind from public.shelves
    where id = new.shelf_id and user_id = auth.uid();
  if not found then
    raise no_data_found using message = 'shelf not found';
  end if;

  select work_id into v_work_id from public.editions
    where simania_id = new.simania_id for share;
  if not found then
    raise foreign_key_violation using message = 'edition not found';
  end if;

  if exists (select 1 from public.shelf_books
             where user_id = auth.uid() and simania_id = new.simania_id) then
    raise unique_violation using message = 'edition already shelved', constraint = 'shelf_books_pkey';
  end if;
  if v_work_id is not null and exists (
    select 1 from public.shelf_books sb
    join public.editions e on e.simania_id = sb.simania_id
    where sb.user_id = auth.uid() and e.work_id = v_work_id
  ) then
    raise unique_violation using message = 'work already shelved', constraint = 'shelf_books_user_work_key';
  end if;

  select coalesce(max(position) + 1, 0) into new.position
    from public.shelf_books where shelf_id = new.shelf_id;
  new.added_at := now();
  new.finished_at := case when v_kind = 'read' then now() else null end;
  new.rating := null;

  if v_work_id is not null then
    delete from public.recommendations
      where user_id = auth.uid() and work_id = v_work_id and not dismissed;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_shelf_book_insert() from public, anon, authenticated;
create trigger shelf_books_prepare_insert before insert on public.shelf_books
for each row execute function public.prepare_shelf_book_insert();

create or replace function public.protect_shelf_book_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id
     or new.simania_id is distinct from old.simania_id
     or new.added_at is distinct from old.added_at then
    raise exception using errcode = '22023', message = 'book identity and added_at are immutable';
  end if;
  if not exists (select 1 from public.shelves where id = new.shelf_id and user_id = new.user_id) then
    raise exception using errcode = '23514', message = 'shelf must belong to user';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_shelf_book_update() from public, anon, authenticated;
create trigger shelf_books_protect_update before update on public.shelf_books
for each row execute function public.protect_shelf_book_update();

create or replace function public.prevent_recommendation_undismiss()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.dismissed and not new.dismissed then
    raise exception using errcode = '22023', message = 'dismissal is permanent';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_recommendation_undismiss() from public, anon, authenticated;
create trigger recommendations_prevent_undismiss before update of dismissed on public.recommendations
for each row execute function public.prevent_recommendation_undismiss();

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.move_book(p_simania_id integer, p_to_shelf uuid, p_to_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_source uuid;
  v_old_position integer;
  v_target_kind public.shelf_kind;
  v_count integer;
begin
  if v_user is null then raise insufficient_privilege using message = 'authentication required'; end if;
  perform 1 from public.profiles where id = v_user for update;
  if not found then raise no_data_found using message = 'profile not found'; end if;

  select shelf_id, position into v_source, v_old_position
    from public.shelf_books where user_id = v_user and simania_id = p_simania_id;
  if not found then raise no_data_found using message = 'book not found'; end if;
  select kind into v_target_kind from public.shelves where id = p_to_shelf and user_id = v_user;
  if not found then raise no_data_found using message = 'shelf not found'; end if;

  if v_source = p_to_shelf then
    select count(*)::integer into v_count from public.shelf_books where shelf_id = v_source;
    if p_to_position is null or p_to_position < 0 or p_to_position >= v_count then
      raise exception using errcode = '22023', message = 'invalid book position';
    end if;
    if p_to_position < v_old_position then
      update public.shelf_books set position = position + 1
       where user_id = v_user and shelf_id = v_source
         and position >= p_to_position and position < v_old_position;
    elsif p_to_position > v_old_position then
      update public.shelf_books set position = position - 1
       where user_id = v_user and shelf_id = v_source
         and position > v_old_position and position <= p_to_position;
    end if;
  else
    select count(*)::integer into v_count from public.shelf_books where shelf_id = p_to_shelf;
    if p_to_position is null or p_to_position < 0 or p_to_position > v_count then
      raise exception using errcode = '22023', message = 'invalid book position';
    end if;
    update public.shelf_books set position = position - 1
      where user_id = v_user and shelf_id = v_source and position > v_old_position;
    update public.shelf_books set position = position + 1
      where user_id = v_user and shelf_id = p_to_shelf and position >= p_to_position;
  end if;

  update public.shelf_books
     set shelf_id = p_to_shelf,
         position = p_to_position,
         finished_at = case when v_target_kind = 'read' and finished_at is null
                            then now() else finished_at end
   where user_id = v_user and simania_id = p_simania_id;
end;
$$;

create or replace function private.move_shelf(p_shelf_id uuid, p_to_position integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_old_position integer;
  v_count integer;
begin
  if v_user is null then raise insufficient_privilege using message = 'authentication required'; end if;
  perform 1 from public.profiles where id = v_user for update;
  if not found then raise no_data_found using message = 'profile not found'; end if;
  select position into v_old_position from public.shelves where id = p_shelf_id and user_id = v_user;
  if not found then raise no_data_found using message = 'shelf not found'; end if;
  select count(*)::integer into v_count from public.shelves where user_id = v_user;
  if p_to_position is null or p_to_position < 0 or p_to_position >= v_count then
    raise exception using errcode = '22023', message = 'invalid shelf position';
  end if;
  if p_to_position < v_old_position then
    update public.shelves set position = position + 1
      where user_id = v_user and position >= p_to_position and position < v_old_position;
  elsif p_to_position > v_old_position then
    update public.shelves set position = position - 1
      where user_id = v_user and position > v_old_position and position <= p_to_position;
  end if;
  update public.shelves set position = p_to_position where id = p_shelf_id and user_id = v_user;
end;
$$;

create or replace function private.delete_shelf(p_shelf_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_kind public.shelf_kind;
  v_old_position integer;
  v_want uuid;
  v_want_count integer;
begin
  if v_user is null then raise insufficient_privilege using message = 'authentication required'; end if;
  perform 1 from public.profiles where id = v_user for update;
  if not found then raise no_data_found using message = 'profile not found'; end if;
  select kind, position into v_kind, v_old_position
    from public.shelves where id = p_shelf_id and user_id = v_user;
  if not found then raise no_data_found using message = 'shelf not found'; end if;
  if v_kind <> 'custom' then
    raise exception using errcode = '22023', message = 'default shelves cannot be deleted';
  end if;
  select id into v_want from public.shelves where user_id = v_user and kind = 'want';
  select count(*)::integer into v_want_count from public.shelf_books where shelf_id = v_want;
  with moved as (
    select simania_id, row_number() over (order by position) - 1 as offset
    from public.shelf_books where user_id = v_user and shelf_id = p_shelf_id
  )
  update public.shelf_books sb
     set shelf_id = v_want, position = v_want_count + moved.offset
    from moved where sb.user_id = v_user and sb.simania_id = moved.simania_id;
  delete from public.shelves where id = p_shelf_id and user_id = v_user;
  update public.shelves set position = position - 1
    where user_id = v_user and position > v_old_position;
end;
$$;

create or replace function private.remove_book(p_simania_id integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_shelf uuid;
  v_position integer;
begin
  if v_user is null then raise insufficient_privilege using message = 'authentication required'; end if;
  perform 1 from public.profiles where id = v_user for update;
  if not found then raise no_data_found using message = 'profile not found'; end if;
  select shelf_id, position into v_shelf, v_position
    from public.shelf_books where user_id = v_user and simania_id = p_simania_id;
  if not found then raise no_data_found using message = 'book not found'; end if;
  delete from public.shelf_books where user_id = v_user and simania_id = p_simania_id;
  update public.shelf_books set position = position - 1
    where user_id = v_user and shelf_id = v_shelf and position > v_position;
end;
$$;

revoke all on function private.move_book(integer, uuid, integer),
  private.move_shelf(uuid, integer), private.delete_shelf(uuid), private.remove_book(integer)
  from public, anon;
grant execute on function private.move_book(integer, uuid, integer),
  private.move_shelf(uuid, integer), private.delete_shelf(uuid), private.remove_book(integer)
  to authenticated;

create or replace function public.move_book(p_simania_id integer, p_to_shelf uuid, p_to_position integer)
returns void language sql security invoker set search_path = ''
as $$ select private.move_book(p_simania_id, p_to_shelf, p_to_position) $$;
create or replace function public.move_shelf(p_shelf_id uuid, p_to_position integer)
returns void language sql security invoker set search_path = ''
as $$ select private.move_shelf(p_shelf_id, p_to_position) $$;
create or replace function public.delete_shelf(p_shelf_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_shelf(p_shelf_id) $$;
create or replace function public.remove_book(p_simania_id integer)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_book(p_simania_id) $$;

revoke all on function public.move_book(integer, uuid, integer),
  public.move_shelf(uuid, integer), public.delete_shelf(uuid), public.remove_book(integer)
  from public, anon;
grant execute on function public.move_book(integer, uuid, integer),
  public.move_shelf(uuid, integer), public.delete_shelf(uuid), public.remove_book(integer)
  to authenticated;
