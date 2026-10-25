-- Invitations sent by signed-in users through the invite-user Edge Function.
-- Rows are written only by that function (service role); each user can read
-- the invitations they sent, which the invite page lists.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create index invitations_inviter_created_idx on public.invitations (inviter_id, created_at desc);

alter table public.invitations enable row level security;

create policy invitations_select_own on public.invitations
  for select to authenticated
  using (inviter_id = auth.uid());

revoke insert, update, delete on public.invitations from anon, authenticated;
