-- Personal 1-5 rating per user and shelved book (shelf_books.rating), set from
-- the book card on any shelf. null clears it. Recommendations weight seeds by it.
create or replace function private.set_rating(p_simania_id integer, p_rating smallint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise insufficient_privilege using message = 'authentication required'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception using errcode = '22023', message = 'rating must be 1 to 5';
  end if;
  update public.shelf_books set rating = p_rating
   where user_id = v_user and simania_id = p_simania_id;
  if not found then raise no_data_found using message = 'book not found'; end if;
end;
$$;

revoke all on function private.set_rating(integer, smallint) from public, anon;
grant execute on function private.set_rating(integer, smallint) to authenticated;

create or replace function public.set_rating(p_simania_id integer, p_rating smallint)
returns void language sql security invoker set search_path = ''
as $$ select private.set_rating(p_simania_id, p_rating) $$;

revoke all on function public.set_rating(integer, smallint) from public, anon;
grant execute on function public.set_rating(integer, smallint) to authenticated;
