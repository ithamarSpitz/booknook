update public.recommendations
set simania_id = null
where simania_id < 0;

update public.genre_recommendations
set simania_id = null
where simania_id < 0;

alter table public.recommendations
  add constraint recommendations_simania_id_positive_check
  check (simania_id is null or simania_id > 0);

alter table public.genre_recommendations
  add constraint genre_recommendations_simania_id_positive_check
  check (simania_id is null or simania_id > 0);
