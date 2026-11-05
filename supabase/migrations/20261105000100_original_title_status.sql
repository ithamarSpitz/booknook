-- Editions linked by the off-cloud repair script from Simania's original title.
alter type public.resolve_status add value if not exists 'original_title';
