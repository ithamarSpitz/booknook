-- Editions linked by the NLI author catalog fallback.
alter type public.resolve_status add value if not exists 'nli_author';
