-- History of every change to a user's shelves, for statistics later.
-- Filled only by the trigger on public.shelf_books, so every path (add-book,
-- move_book, delete_shelf, remove_book, rating edits) is recorded the same way.
-- Shelf ids are kept without a foreign key (custom shelves can be deleted);
-- the shelf kind and name are snapshotted at the time of the event.
create table public.book_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  simania_id integer not null,
  action text not null check (action in ('added', 'moved', 'removed', 'rated')),
  from_shelf_id uuid,
  from_shelf_kind text,
  from_shelf_name text,
  to_shelf_id uuid,
  to_shelf_kind text,
  to_shelf_name text,
  rating smallint,
  occurred_at timestamptz not null default now()
);

create index book_events_user_time_idx on public.book_events (user_id, occurred_at desc);
create index book_events_book_idx on public.book_events (simania_id);

alter table public.book_events enable row level security;

create policy book_events_select_own on public.book_events
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.book_events from anon, authenticated;

create or replace function private.log_book_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_from_kind text;
  v_from_name text;
  v_to_kind text;
  v_to_name text;
begin
  if tg_op = 'INSERT' then
    select kind::text, name into v_to_kind, v_to_name from public.shelves where id = new.shelf_id;
    insert into public.book_events (user_id, simania_id, action, to_shelf_id, to_shelf_kind, to_shelf_name, rating)
    values (new.user_id, new.simania_id, 'added', new.shelf_id, v_to_kind, v_to_name, new.rating);
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Deleting the account cascades here; its history goes with it.
    if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
    select kind::text, name into v_from_kind, v_from_name from public.shelves where id = old.shelf_id;
    insert into public.book_events (user_id, simania_id, action, from_shelf_id, from_shelf_kind, from_shelf_name, rating)
    values (old.user_id, old.simania_id, 'removed', old.shelf_id, v_from_kind, v_from_name, old.rating);
    return old;
  end if;

  -- UPDATE: reordering within a shelf (position only) is not an event.
  if new.shelf_id is distinct from old.shelf_id then
    select kind::text, name into v_from_kind, v_from_name from public.shelves where id = old.shelf_id;
    select kind::text, name into v_to_kind, v_to_name from public.shelves where id = new.shelf_id;
    insert into public.book_events (user_id, simania_id, action, from_shelf_id, from_shelf_kind, from_shelf_name,
                                    to_shelf_id, to_shelf_kind, to_shelf_name, rating)
    values (new.user_id, new.simania_id, 'moved', old.shelf_id, v_from_kind, v_from_name,
            new.shelf_id, v_to_kind, v_to_name, new.rating);
  end if;
  if new.rating is distinct from old.rating then
    select kind::text, name into v_to_kind, v_to_name from public.shelves where id = new.shelf_id;
    insert into public.book_events (user_id, simania_id, action, to_shelf_id, to_shelf_kind, to_shelf_name, rating)
    values (new.user_id, new.simania_id, 'rated', new.shelf_id, v_to_kind, v_to_name, new.rating);
  end if;
  return new;
end;
$$;

revoke all on function private.log_book_event() from public;

create trigger shelf_books_log_events
  after insert or update or delete on public.shelf_books
  for each row execute function private.log_book_event();
