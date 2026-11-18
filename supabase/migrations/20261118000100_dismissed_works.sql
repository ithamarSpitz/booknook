create table public.dismissed_works (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id uuid not null references public.works(id) on delete cascade,
  kind text not null check (kind in ('hide', 'not_my_type')),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

alter table public.dismissed_works enable row level security;

create policy dismissed_works_select_own on public.dismissed_works
  for select to authenticated using (user_id = auth.uid());

revoke all on table public.dismissed_works from public, anon, authenticated;
grant all on table public.dismissed_works to service_role;
grant select on table public.dismissed_works to authenticated;

insert into public.dismissed_works (user_id, work_id, kind, dismissed_at)
select user_id, work_id, 'hide', generated_at
  from public.recommendations
 where dismissed
on conflict (user_id, work_id) do nothing;

create function public.dismiss_work(p_work_id uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  if p_kind is null or p_kind not in ('hide', 'not_my_type') then
    raise exception using errcode = '22023', message = 'invalid dismissal kind';
  end if;

  if not exists (select 1 from public.works where id = p_work_id) then
    raise exception using errcode = '23503', message = 'work not found';
  end if;

  insert into public.dismissed_works (user_id, work_id, kind, dismissed_at)
  values (v_user, p_work_id, p_kind, clock_timestamp())
  on conflict (user_id, work_id) do update
    set kind = excluded.kind,
        dismissed_at = excluded.dismissed_at;

  update public.recommendations
     set dismissed = true
   where user_id = v_user and work_id = p_work_id;

  delete from public.genre_recommendations
   where user_id = v_user and work_id = p_work_id;
end;
$$;

revoke all on function public.dismiss_work(uuid, text)
  from public, anon, authenticated;
grant execute on function public.dismiss_work(uuid, text) to authenticated;

create function public.restore_work(p_work_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  delete from public.dismissed_works
   where user_id = v_user and work_id = p_work_id;

  if found then
    delete from public.recommendations
     where user_id = v_user and work_id = p_work_id;
  end if;
end;
$$;

revoke all on function public.restore_work(uuid)
  from public, anon, authenticated;
grant execute on function public.restore_work(uuid) to authenticated;

revoke update (dismissed) on public.recommendations from authenticated;
